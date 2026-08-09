import { describe, it, expect } from "vitest";
import { PRICING_TIERS, resolveEntitlementTier, authorizeCampaignTier, PLAN_LIMITS } from "../src/services/pricingService";

describe("PRICING_TIERS", () => {
  it("includes FREE, STARTER, GROWTH, and ENTERPRISE tiers", () => {
    expect(PRICING_TIERS.FREE).toBeDefined();
    expect(PRICING_TIERS.STARTER).toBeDefined();
    expect(PRICING_TIERS.GROWTH).toBeDefined();
    expect(PRICING_TIERS.ENTERPRISE).toBeDefined();
  });

  it("has correct prices for paid tiers", () => {
    expect(PRICING_TIERS.STARTER.priceInr).toBe(5499);
    expect(PRICING_TIERS.GROWTH.priceInr).toBe(11999);
    expect(PRICING_TIERS.ENTERPRISE.priceInr).toBeNull();
  });

  it("FREE tier has null price", () => {
    expect(PRICING_TIERS.FREE.priceInr).toBeNull();
  });

  it("STARTER is one_time and GROWTH/ENTERPRISE are monthly", () => {
    expect(PRICING_TIERS.STARTER.billing).toBe("one_time");
    expect(PRICING_TIERS.GROWTH.billing).toBe("monthly");
    expect(PRICING_TIERS.ENTERPRISE.billing).toBe("monthly");
  });
});

describe("PLAN_LIMITS", () => {
  it("FREE allows 30 investor emails and 1 active campaign", () => {
    expect(PLAN_LIMITS.FREE.investorEmails).toBe(30);
    expect(PLAN_LIMITS.FREE.activeCampaigns).toBe(1);
  });

  it("STARTER allows 100 investor emails and unlimited campaigns", () => {
    expect(PLAN_LIMITS.STARTER.investorEmails).toBe(100);
    expect(PLAN_LIMITS.STARTER.activeCampaigns).toBeNull();
  });

  it("GROWTH allows 500 investor emails and unlimited campaigns", () => {
    expect(PLAN_LIMITS.GROWTH.investorEmails).toBe(500);
    expect(PLAN_LIMITS.GROWTH.activeCampaigns).toBeNull();
  });
});

describe("resolveEntitlementTier with one_time STARTER", () => {
  const now = new Date("2026-08-07T00:00:00Z");

  it("returns STARTER for an active STARTER subscription with no period end", () => {
    expect(resolveEntitlementTier({ tier: "STARTER", status: "ACTIVE", current_period_end: null }, now)).toBe("STARTER");
  });

  it("returns FREE for a cancelled STARTER subscription", () => {
    expect(resolveEntitlementTier({ tier: "STARTER", status: "CANCELLED", current_period_end: null }, now)).toBe("FREE");
  });
});

describe("authorizeCampaignTier total email enforcement", () => {
  it("FREE users cannot exceed 30 total emails", () => {
    const result = authorizeCampaignTier(null, "STARTER", new Date("2026-08-07T00:00:00Z"));
    expect(result.allowed).toBe(true);
    expect(result.investorLimit).toBe(30);
  });
});
