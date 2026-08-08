import { describe, it, expect } from "vitest";
import {
  authorizeCampaignTier,
  estimateCampaignCost,
  computeMargin,
  PRICING_TIERS,
  resolveEntitlementTier,
} from "../src/services/pricingService";

describe("estimateCampaignCost", () => {
  it("scales LLM call count with investor count", () => {
    const small = estimateCampaignCost(30);
    const large = estimateCampaignCost(80);
    expect(large.totalLlmCalls).toBeGreaterThan(small.totalLlmCalls);
    expect(large.perInvestorEmailCalls).toBe(80);
  });

  it("always has zero Gmail send cost since sends use the founder's own account", () => {
    const cost = estimateCampaignCost(30);
    expect(cost.gmailSendCostInr).toBe(0);
  });

  it("keeps total cost well under one rupee per investor at this pricing assumption", () => {
    const cost = estimateCampaignCost(30);
    expect(cost.totalEstimatedCostInr / 30).toBeLessThan(1);
  });
});

describe("computeMargin", () => {
  it("produces high gross margin on the Starter tier at 100 investors", () => {
    const margin = computeMargin("STARTER", 100);
    expect(margin.priceInr).toBe(PRICING_TIERS.STARTER.priceInr);
    expect(margin.grossMarginPercent).toBeGreaterThan(90);
  });

  it("keeps margin high even on the larger Growth-tier investor volume", () => {
    const margin = computeMargin("GROWTH", 500);
    expect(margin.grossMarginPercent).toBeGreaterThan(85);
  });

  it("margin scales down slightly as investor count grows, but stays strongly positive", () => {
    const small = computeMargin("STARTER", 30);
    const large = computeMargin("STARTER", 100);
    expect(large.grossMarginPercent).toBeLessThan(small.grossMarginPercent);
    expect(large.grossMarginPercent).toBeGreaterThan(50);
  });
});

describe("resolveEntitlementTier", () => {
  const now = new Date("2026-08-07T00:00:00Z");

  it("treats missing subscriptions as FREE", () => {
    expect(resolveEntitlementTier(null, now)).toBe("FREE");
  });

  it("treats cancelled subscriptions as FREE", () => {
    expect(resolveEntitlementTier({ tier: "GROWTH", status: "CANCELLED" }, now)).toBe("FREE");
  });

  it("treats expired subscriptions as FREE", () => {
    expect(
      resolveEntitlementTier({ tier: "GROWTH", status: "ACTIVE", current_period_end: "2026-08-06T00:00:00Z" }, now)
    ).toBe("FREE");
  });

  it("accepts active paid subscriptions", () => {
    expect(
      resolveEntitlementTier({ tier: "GROWTH", status: "ACTIVE", current_period_end: "2026-09-06T00:00:00Z" }, now)
    ).toBe("GROWTH");
  });
});

describe("authorizeCampaignTier", () => {
  const now = new Date("2026-08-07T00:00:00Z");

  it("allows a free founder to create only the starter campaign shape", () => {
    const result = authorizeCampaignTier(null, "STARTER", now);
    expect(result.allowed).toBe(true);
    expect(result.entitlementTier).toBe("FREE");
    expect(result.investorLimit).toBe(30);
    expect(result.activeCampaignLimit).toBe(1);
  });

  it("blocks a free founder from forging a growth campaign request", () => {
    const result = authorizeCampaignTier(null, "GROWTH", now);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/upgrade required/i);
  });

  it("blocks starter users from requesting growth limits", () => {
    const result = authorizeCampaignTier({ tier: "STARTER", status: "ACTIVE" }, "GROWTH", now);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/current plan/i);
  });

  it("uses paid plan limits for authorized campaigns", () => {
    const result = authorizeCampaignTier({ tier: "GROWTH", status: "ACTIVE" }, "STARTER", now);
    expect(result.allowed).toBe(true);
    expect(result.entitlementTier).toBe("GROWTH");
    expect(result.investorLimit).toBe(500);
    expect(result.activeCampaignLimit).toBeNull();
  });
});
