import { describe, it, expect } from "vitest";
import { scoreInvestor, rankInvestors, resolveMatchingKeywords, CompanyProfile, InvestorProfile, WarmthRecord } from "../src/services/matchingService";

const now = new Date("2026-08-06T00:00:00Z");

function baseCompany(overrides: Partial<CompanyProfile> = {}): CompanyProfile {
  return {
    stage: "SEED",
    sector: ["fintech", "payments"],
    geography: ["India"],
    askAmountUsd: 500_000,
    extractedKeywords: ["cross-border", "b2c payments", "remittance"],
    ...overrides,
  };
}

function baseInvestor(overrides: Partial<InvestorProfile> = {}): InvestorProfile {
  return {
    id: "inv_1",
    name: "Test Investor",
    firm: "Test Capital",
    stageFocus: ["SEED"],
    sectorFocus: ["fintech", "payments"],
    geoFocus: ["India"],
    checkSizeMinUsd: 250_000,
    checkSizeMaxUsd: 1_000_000,
    thesisKeywords: ["cross-border", "remittance"],
    lastKnownActiveAt: new Date("2026-06-01T00:00:00Z"),
    isVerified: true,
    ...overrides,
  };
}

describe("scoreInvestor", () => {
  it("gives a near-perfect score for an exact-fit investor", () => {
    const result = scoreInvestor(baseCompany(), baseInvestor(), null, now);
    expect(result.excluded).toBe(false);
    expect(result.score).toBeGreaterThan(75);
  });

  it("excludes unverified investors regardless of thesis fit", () => {
    const result = scoreInvestor(baseCompany(), baseInvestor({ isVerified: false }), null, now);
    expect(result.excluded).toBe(true);
    expect(result.exclusionReason).toMatch(/not yet verified/i);
    expect(result.score).toBe(0);
  });

  it("excludes an investor who already passed, even if thesis-fit is perfect", () => {
    const warmth: WarmthRecord = { investorId: "inv_1", status: "REPLIED_PASS" };
    const result = scoreInvestor(baseCompany(), baseInvestor(), warmth, now);
    expect(result.excluded).toBe(true);
    expect(result.exclusionReason).toMatch(/already passed/i);
  });

  it("boosts score meaningfully for previously interested investors", () => {
    const cold = scoreInvestor(baseCompany(), baseInvestor(), null, now);
    const warmth: WarmthRecord = { investorId: "inv_1", status: "REPLIED_INTERESTED" };
    const warm = scoreInvestor(baseCompany(), baseInvestor(), warmth, now);
    expect(warm.score).toBeGreaterThan(cold.score);
    expect(warm.reasons[0]).toMatch(/previously replied/i);
  });

  it("scores meeting-booked investors higher than merely interested ones", () => {
    const interested = scoreInvestor(
      baseCompany(),
      baseInvestor(),
      { investorId: "inv_1", status: "REPLIED_INTERESTED" },
      now
    );
    const meeting = scoreInvestor(
      baseCompany(),
      baseInvestor(),
      { investorId: "inv_1", status: "MEETING_BOOKED" },
      now
    );
    expect(meeting.score).toBeGreaterThanOrEqual(interested.score);
  });

  it("penalizes stage mismatch heavily for a 2-stage gap", () => {
    const result = scoreInvestor(
      baseCompany({ stage: "SERIES_B_PLUS" }),
      baseInvestor({ stageFocus: ["PRE_SEED"] }),
      null,
      now
    );
    expect(result.breakdown.stageFit).toBe(0);
  });

  it("gives partial credit for an adjacent stage", () => {
    const result = scoreInvestor(
      baseCompany({ stage: "SEED" }),
      baseInvestor({ stageFocus: ["PRE_SEED"] }),
      null,
      now
    );
    expect(result.breakdown.stageFit).toBeGreaterThan(0);
    expect(result.breakdown.stageFit).toBeLessThan(25);
  });

  it("scores zero sector fit when there is no overlap at all", () => {
    const result = scoreInvestor(
      baseCompany({ sector: ["biotech"], extractedKeywords: ["gene therapy"] }),
      baseInvestor({ sectorFocus: ["fintech"], thesisKeywords: ["payments"] }),
      null,
      now
    );
    expect(result.breakdown.sectorFit).toBe(0);
  });

  it("normalizes common sector and geography aliases for enriched investor data", () => {
    const result = scoreInvestor(
      baseCompany({ sector: ["AI/ML"], geography: ["US"], extractedKeywords: ["enterprise saas"] }),
      baseInvestor({
        sectorFocus: ["AI", "Enterprise"],
        geoFocus: ["United States"],
        thesisKeywords: ["B2B SaaS"],
      }),
      null,
      now
    );

    expect(result.breakdown.sectorFit).toBeGreaterThan(0);
    expect(result.breakdown.geoFit).toBeGreaterThan(0);
    expect(result.reasons.join(" ")).toMatch(/sector thesis overlap/i);
  });

  it("gives full check-size credit when ask falls inside fund range", () => {
    const result = scoreInvestor(baseCompany({ askAmountUsd: 600_000 }), baseInvestor(), null, now);
    expect(result.breakdown.checkSizeFit).toBe(15);
  });

  it("gives partial check-size credit when ask is just outside range", () => {
    // fund max is 1,000,000; ask is 1,200,000 -> 20% over, within the 30% partial-credit band
    const result = scoreInvestor(baseCompany({ askAmountUsd: 1_200_000 }), baseInvestor(), null, now);
    expect(result.breakdown.checkSizeFit).toBeGreaterThan(0);
    expect(result.breakdown.checkSizeFit).toBeLessThan(15);
  });

  it("gives zero check-size credit when ask is wildly outside range", () => {
    const result = scoreInvestor(baseCompany({ askAmountUsd: 10_000_000 }), baseInvestor(), null, now);
    expect(result.breakdown.checkSizeFit).toBe(0);
  });

  it("discounts recency for a stale contact", () => {
    const fresh = scoreInvestor(baseCompany(), baseInvestor(), null, now);
    const stale = scoreInvestor(
      baseCompany(),
      baseInvestor({ lastKnownActiveAt: new Date("2024-01-01T00:00:00Z") }),
      null,
      now
    );
    expect(stale.breakdown.recencyFit).toBeLessThan(fresh.breakdown.recencyFit);
  });

  it("never exceeds a score of 100", () => {
    const result = scoreInvestor(
      baseCompany(),
      baseInvestor(),
      { investorId: "inv_1", status: "MEETING_BOOKED" },
      now
    );
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

describe("rankInvestors", () => {
  it("ranks by descending score and respects the limit", () => {
    const company = baseCompany();
    const investors: InvestorProfile[] = [
      baseInvestor({ id: "a", sectorFocus: ["fintech", "payments"] }), // strong fit
      baseInvestor({ id: "b", sectorFocus: ["biotech"], thesisKeywords: ["gene therapy"] }), // weak fit
      baseInvestor({ id: "c", isVerified: false }), // excluded
    ];
    const results = rankInvestors(company, investors, new Map(), 2, now);
    expect(results.length).toBe(2);
    expect(results[0]?.investorId).toBe("a");
    expect(results.every((r) => !r.excluded)).toBe(true);
  });

  it("excludes investors with zero score from the ranked output", () => {
    const company = baseCompany();
    const investors: InvestorProfile[] = [
      baseInvestor({ id: "a" }),
      baseInvestor({
        id: "b",
        stageFocus: ["SERIES_B_PLUS"],
        sectorFocus: ["biotech"],
        thesisKeywords: ["oncology"],
        geoFocus: ["Germany"],
        checkSizeMinUsd: 5_000_000,
        checkSizeMaxUsd: 20_000_000,
      }),
    ];
    const results = rankInvestors(company, investors, new Map(), 10, now);
    expect(results.find((r) => r.investorId === "b")).toBeUndefined();
  });
});

describe("resolveMatchingKeywords", () => {
  it("uses extractedKeywords when present (generated-deck path)", () => {
    const result = resolveMatchingKeywords(["cross-border", "remittance"], ["fintech"]);
    expect(result).toEqual(["cross-border", "remittance"]);
  });

  it("falls back to sector tags when extractedKeywords is empty (upload-fallback path)", () => {
    const result = resolveMatchingKeywords([], ["fintech", "payments"]);
    expect(result).toEqual(["fintech", "payments"]);
  });

  it("falls back to sector tags when extractedKeywords is null/undefined", () => {
    const result = resolveMatchingKeywords(null as unknown as string[], ["saas"]);
    expect(result).toEqual(["saas"]);
  });

  it("returns an empty array, not a crash, when both inputs are empty", () => {
    const result = resolveMatchingKeywords([], []);
    expect(result).toEqual([]);
  });
});
