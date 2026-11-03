import { describe, it, expect } from "vitest";
import {
  scoreInvestor,
  rankInvestors,
  resolveMatchingKeywords,
  validateWeights,
  eligibilityFailure,
  fundKey,
  DEFAULT_WEIGHTS,
  CompanyProfile,
  InvestorProfile,
  WarmthRecord,
} from "../src/services/matchingService";

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

describe("weights", () => {
  it("defaults to the agreed split and sums to 100", () => {
    expect(DEFAULT_WEIGHTS).toEqual({ sector: 20, stage: 15, checkSize: 15, thesis: 15, businessModel: 10, geography: 10, founderMarketFit: 10, tractionMandate: 5 });
    expect(validateWeights(DEFAULT_WEIGHTS).ok).toBe(true);
  });

  it("rejects weights that don't sum to 100, negatives, and unknown keys", () => {
    expect(validateWeights({ ...DEFAULT_WEIGHTS, sector: 30 })).toMatchObject({ ok: false, error: expect.stringMatching(/add up to 100/) });
    expect(validateWeights({ ...DEFAULT_WEIGHTS, sector: -5, stage: 40 }).ok).toBe(false);
    expect(validateWeights({ ...DEFAULT_WEIGHTS, vibes: 0 }).ok).toBe(false);
    expect(validateWeights({ sector: 100 }).ok).toBe(false);
  });

  it("changes ranking when reconfigured", () => {
    const company = baseCompany({ businessTypes: ["SAAS"], preferredCheck: { min: 200_000, max: 500_000 } });
    const a = baseInvestor({ id: "a", businessModels: ["SAAS"], checkSizeMinUsd: 5_000, checkSizeMaxUsd: 10_000 });
    const b = baseInvestor({ id: "b", businessModels: ["MARKETPLACE"] });
    const modelHeavy = { sector: 5, stage: 5, checkSize: 5, thesis: 5, businessModel: 70, geography: 5, founderMarketFit: 0, tractionMandate: 5 };
    const checkHeavy = { sector: 5, stage: 5, checkSize: 70, thesis: 5, businessModel: 5, geography: 5, founderMarketFit: 0, tractionMandate: 5 };
    expect(rankInvestors(company, [a, b], new Map(), 2, now, modelHeavy)[0]!.investorId).toBe("a");
    expect(rankInvestors(company, [a, b], new Map(), 2, now, checkHeavy)[0]!.investorId).toBe("b");
  });
});

describe("scoreInvestor", () => {
  it("gives a near-perfect score for an exact-fit investor", () => {
    const result = scoreInvestor(baseCompany(), baseInvestor(), null, now);
    expect(result.excluded).toBe(false);
    expect(result.score).toBeGreaterThan(75);
  });

  it("renormalizes over components with evidence and reports the rest as missing (never guessed)", () => {
    const result = scoreInvestor(baseCompany(), baseInvestor(), null, now);
    expect(result.components.businessModel.score).toBeNull();
    expect(result.components.founderMarketFit.score).toBeNull();
    expect(result.components.tractionMandate.score).toBeNull();
    expect(result.coverage).toBe(0.75);
    expect(result.missing.join(" ")).toMatch(/Business model: not enough data/);
  });

  it("uses enrichment fields when they exist", () => {
    const company = baseCompany({ businessTypes: ["SAAS"], founderSignals: ["technical", "payments"], hasRevenue: false });
    const fit = scoreInvestor(company, baseInvestor({ businessModels: ["SAAS"], founderPreferences: ["technical"], tractionRequirement: "PRE_REVENUE_OK" }), null, now);
    expect(fit.coverage).toBe(1);
    expect(fit.reasons.join(" ")).toMatch(/Looks for technical founders/);
    const strict = scoreInvestor(company, baseInvestor({ tractionRequirement: "REVENUE_REQUIRED" }), null, now);
    expect(strict.components.tractionMandate.score).toBe(0);
    expect(strict.mismatches).toContain("Usually requires revenue before investing");
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

  it("surfaces prior interest as a reason without inflating the score", () => {
    const cold = scoreInvestor(baseCompany(), baseInvestor(), null, now);
    const warm = scoreInvestor(baseCompany(), baseInvestor(), { investorId: "inv_1", status: "REPLIED_INTERESTED" }, now);
    expect(warm.reasons[0]).toMatch(/previously replied/i);
    expect(warm.score).toBe(cold.score);
  });

  it("gives half stage credit one stage away and excludes two stages away", () => {
    expect(scoreInvestor(baseCompany(), baseInvestor({ stageFocus: ["PRE_SEED"] }), null, now).components.stage.score).toBe(0.5);
    const far = scoreInvestor(baseCompany(), baseInvestor({ stageFocus: ["SERIES_B_PLUS"] }), null, now);
    expect(far.excluded).toBe(true);
    expect(far.exclusionReason).toMatch(/not seed/);
  });

  it("normalizes common sector and geography aliases", () => {
    const result = scoreInvestor(
      baseCompany({ sector: ["AI/ML", "SaaS"], geography: ["USA"], extractedKeywords: [] }),
      baseInvestor({ sectorFocus: ["Artificial Intelligence", "Software as a Service"], geoFocus: ["United States"], thesisKeywords: [] }),
      null,
      now
    );
    expect(result.components.sector.score).toBeGreaterThan(0);
    expect(result.components.geography.score).toBe(1);
  });

  it("scores cheque fit against the founder's preferred range, falling back to the round size", () => {
    expect(scoreInvestor(baseCompany(), baseInvestor(), null, now).components.checkSize.score).toBe(1);
    const tooSmall = scoreInvestor(baseCompany({ preferredCheck: { min: 300_000, max: 500_000 } }), baseInvestor({ checkSizeMinUsd: 25_000, checkSizeMaxUsd: 50_000 }), null, now);
    expect(tooSmall.components.checkSize.score).toBe(0);
    expect(tooSmall.mismatches.join(" ")).toMatch(/outside your preferred range/);
    const nearly = scoreInvestor(baseCompany({ preferredCheck: { min: 300_000, max: 500_000 } }), baseInvestor({ checkSizeMinUsd: 50_000, checkSizeMaxUsd: 200_000 }), null, now);
    expect(nearly.components.checkSize.score).toBe(0.4);
  });

  it("flags a stale contact as a mismatch", () => {
    const stale = scoreInvestor(baseCompany(), baseInvestor({ lastKnownActiveAt: new Date("2025-01-01T00:00:00Z") }), null, now);
    expect(stale.mismatches).toContain("No known investment activity in the last 9 months");
  });

  it("never exceeds a score of 100", () => {
    const result = scoreInvestor(baseCompany(), baseInvestor(), { investorId: "inv_1", status: "MEETING_BOOKED" }, now);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

describe("hard eligibility filters", () => {
  it("excludes funds that aren't investing, founder exclusions, wrong geography and oversized cheques", () => {
    const c = baseCompany({ excludedInvestorIds: ["x1"], excludedNames: ["Blocked Ventures"] });
    expect(eligibilityFailure(c, baseInvestor({ fundStatus: "NOT_INVESTING" }), null)).toMatch(/not currently investing/);
    expect(eligibilityFailure(c, baseInvestor({ id: "x1" }), null)).toMatch(/excluded/);
    expect(eligibilityFailure(c, baseInvestor({ firm: "blocked  ventures" }), null)).toMatch(/excluded/);
    expect(eligibilityFailure(c, baseInvestor({ geoFocus: ["Germany"] }), null)).toMatch(/Germany only/);
    expect(eligibilityFailure(c, baseInvestor({ geoFocus: ["Global"] }), null)).toBeNull();
    expect(eligibilityFailure(c, baseInvestor({ checkSizeMinUsd: 2_000_000, checkSizeMaxUsd: 5_000_000 }), null)).toMatch(/larger than your whole round/);
  });

  it("excludes investors that only cover sectors the founder excluded", () => {
    const c = baseCompany({ sector: ["fintech", "crypto"], excludedSectors: ["crypto"] });
    expect(eligibilityFailure(c, baseInvestor({ sectorFocus: ["crypto"] }), null)).toMatch(/sectors you excluded/);
  });

  it("treats preferences as preferences: a non-preferred investor type is a mismatch, not an exclusion", () => {
    const r = scoreInvestor(baseCompany({ preferredInvestorTypes: ["VC"] }), baseInvestor({ investorType: "ANGEL" }), null, now);
    expect(r.excluded).toBe(false);
    expect(r.mismatches.join(" ")).toMatch(/isn't one you prefer/);
  });
});

describe("rankInvestors", () => {
  it("ranks by descending score and respects the limit", () => {
    const investors: InvestorProfile[] = [
      baseInvestor({ id: "a", sectorFocus: ["fintech", "payments"] }),
      baseInvestor({ id: "b", sectorFocus: ["fintech", "lending"], stageFocus: ["PRE_SEED"] }),
      baseInvestor({ id: "d", sectorFocus: ["fintech", "payments"], stageFocus: ["PRE_SEED"] }),
      baseInvestor({ id: "c", isVerified: false }),
    ];
    const results = rankInvestors(baseCompany(), investors, new Map(), 2, now);
    expect(results.map((r) => r.investorId)).toEqual(["a", "d"]);
  });

  it("returns nothing (no padding with random contacts) when nobody fits", () => {
    const results = rankInvestors(baseCompany(), [baseInvestor({ sectorFocus: ["biotech"] }), baseInvestor({ id: "z", stageFocus: ["SERIES_B_PLUS"] })], new Map(), 10, now);
    expect(results).toHaveLength(0);
  });

  it("still matches on partial data (incomplete investor profile) with lower coverage", () => {
    const sparse = baseInvestor({ checkSizeMinUsd: null, checkSizeMaxUsd: null, thesisKeywords: [], geoFocus: [] });
    const [r] = rankInvestors(baseCompany(), [sparse], new Map(), 10, now);
    expect(r).toBeDefined();
    expect(r!.coverage).toBeLessThan(0.5);
  });
});

describe("fundKey", () => {
  it("treats spelling variants of one fund as the same fund", () => {
    expect(fundKey(" Fund  X ")).toBe(fundKey("fund x"));
  });
});

describe("resolveMatchingKeywords", () => {
  it("uses extractedKeywords when present", () => {
    expect(resolveMatchingKeywords(["cross-border", "remittance"], ["fintech"])).toEqual(["cross-border", "remittance"]);
  });
  it("falls back to sector tags", () => {
    expect(resolveMatchingKeywords([], ["fintech", "payments"])).toEqual(["fintech", "payments"]);
    expect(resolveMatchingKeywords(null as unknown as string[], ["saas"])).toEqual(["saas"]);
    expect(resolveMatchingKeywords([], [])).toEqual([]);
  });
});
