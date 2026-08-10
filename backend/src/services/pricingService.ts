/**
 * pricingService.ts
 *
 * Tiers, in INR. "Send to everyone" is deliberately NOT a tier — see reasoning in
 * conversation. It's replaced with a scored "expand targeting" add-on so paying more
 * never means becoming spammier.
 *
 * Cost model below uses conservative LLM pricing assumptions so you can see the actual
 * margin instead of guessing. Update MODEL_COST_PER_CALL_INR when you pick a real model/provider.
 */

export type PlanTierId = "FREE" | "STARTER" | "GROWTH" | "ENTERPRISE";
export type EntitlementTierId = "FREE" | PlanTierId;

export interface PricingTier {
  id: PlanTierId;
  name: string;
  priceInr: number | null;
  billing: "one_time" | "monthly";
  includes: string[];
}

export const PRICING_TIERS: Record<PlanTierId, PricingTier> = {
  FREE: {
    id: "FREE",
    name: "Free",
    priceInr: null,
    billing: "one_time",
    includes: [
      "Upload your own deck (no AI-guided interview)",
      "Preview up to 30 best-fit investors from the verified database",
      "Send up to 30 personalized outreach emails",
      "1 active campaign at a time",
    ],
  },
  STARTER: {
    id: "STARTER",
    name: "Starter",
    priceInr: 5499,
    billing: "one_time",
    includes: [
      "AI-guided deck creation (interview + screenshots + founder history), or upload your own deck",
      "Curated, scored list of up to 100 best-fit investors from the verified database",
      "Up to 100 fully personalized outreach emails, ready to review and send",
      "Gmail send at safe warm-up rate (see sendScheduler)",
    ],
  },
  GROWTH: {
    id: "GROWTH",
    name: "Growth",
    priceInr: 11999,
    billing: "monthly",
    includes: [
      "Everything in Starter",
      "Ongoing campaign management: follow-up sequencing, reply tracking, re-targeting",
      "Deck revisions as traction updates (unlimited regenerations)",
      "Full daily send cap unlocked as account warms up (see sendScheduler ramp)",
      "Investor list expands automatically as new verified contacts are added",
    ],
  },
  ENTERPRISE: {
    id: "ENTERPRISE",
    name: "Enterprise",
    priceInr: null,
    billing: "monthly",
    includes: [
      "Everything in Growth",
      "Dedicated investor list curation and manual enrichment support",
      "Priority support and campaign strategy review",
      "Multiple company/raise support under one account",
      "Custom send volume beyond the standard warm-up ceiling, reviewed case by case",
    ],
  },
};

export interface PlanLimits {
  investorEmails: number;
  activeCampaigns: number | null;
  dailySendLimit: number;
  warmupDailyLimit: number;
  postWarmupDailyLimit: number;
}

export const PLAN_LIMITS: Record<EntitlementTierId, PlanLimits> = {
  FREE: {
    investorEmails: 30,
    activeCampaigns: 1,
    dailySendLimit: 50,
    warmupDailyLimit: 50,
    postWarmupDailyLimit: 150,
  },
  STARTER: {
    investorEmails: 100,
    activeCampaigns: null,
    dailySendLimit: 50,
    warmupDailyLimit: 50,
    postWarmupDailyLimit: 150,
  },
  GROWTH: {
    investorEmails: 500,
    activeCampaigns: null,
    dailySendLimit: 150,
    warmupDailyLimit: 150,
    postWarmupDailyLimit: 150,
  },
  ENTERPRISE: {
    investorEmails: Number(process.env.ENTERPRISE_INVESTOR_EMAIL_LIMIT || Number.MAX_SAFE_INTEGER),
    activeCampaigns: process.env.ENTERPRISE_ACTIVE_CAMPAIGN_LIMIT
      ? Number(process.env.ENTERPRISE_ACTIVE_CAMPAIGN_LIMIT)
      : null,
    dailySendLimit: Number(process.env.ENTERPRISE_DAILY_SEND_LIMIT || 500),
    warmupDailyLimit: Number(process.env.ENTERPRISE_WARMUP_DAILY_LIMIT || 500),
    postWarmupDailyLimit: Number(process.env.ENTERPRISE_POST_WARMUP_DAILY_LIMIT || 1000),
  },
};

const PLAN_RANK: Record<EntitlementTierId, number> = {
  FREE: 0,
  STARTER: 1,
  GROWTH: 2,
  ENTERPRISE: 3,
};

export interface SubscriptionRecord {
  tier?: string | null;
  status?: string | null;
  current_period_end?: Date | string | null;
  currentPeriodEnd?: Date | string | null;
}

export interface CampaignTierAuthorization {
  allowed: boolean;
  entitlementTier: EntitlementTierId;
  investorLimit: number;
  activeCampaignLimit: number | null;
  reason?: string;
}

export function resolveEntitlementTier(subscription?: SubscriptionRecord | null, now = new Date()): EntitlementTierId {
  if (!subscription || subscription.status !== "ACTIVE") return "FREE";
  if (!isPlanTier(subscription.tier)) return "FREE";

  const periodEnd = subscription.current_period_end ?? subscription.currentPeriodEnd;
  if (periodEnd && new Date(periodEnd).getTime() <= now.getTime()) return "FREE";

  return subscription.tier;
}

export function authorizeCampaignTier(
  subscription: SubscriptionRecord | null | undefined,
  requestedTier: PlanTierId,
  now = new Date()
): CampaignTierAuthorization {
  const entitlementTier = resolveEntitlementTier(subscription, now);
  const limits = PLAN_LIMITS[entitlementTier];

  if (entitlementTier === "FREE" && requestedTier !== "STARTER") {
    return {
      allowed: false,
      entitlementTier,
      investorLimit: limits.investorEmails,
      activeCampaignLimit: limits.activeCampaigns,
      reason: "Upgrade required for this campaign tier.",
    };
  }

  if (entitlementTier !== "FREE" && PLAN_RANK[requestedTier] > PLAN_RANK[entitlementTier]) {
    return {
      allowed: false,
      entitlementTier,
      investorLimit: limits.investorEmails,
      activeCampaignLimit: limits.activeCampaigns,
      reason: "Your current plan does not include this campaign tier.",
    };
  }

  return {
    allowed: true,
    entitlementTier,
    investorLimit: limits.investorEmails,
    activeCampaignLimit: limits.activeCampaigns,
  };
}

function isPlanTier(tier: unknown): tier is PlanTierId {
  return tier === "STARTER" || tier === "GROWTH" || tier === "ENTERPRISE";
}

// ---------- Unit economics ----------
// Conservative estimate using a low-cost LLM tier for generation calls.
// Update this constant once you've picked a real provider/model and measured actual tokens.
const MODEL_COST_PER_CALL_INR = 0.5; // ~$0.006 at ~83 INR/USD — generous ceiling for a short generation call

export interface CampaignCostBreakdown {
  deckInterviewCalls: number;
  deckSectionGenerationCalls: number;
  perInvestorEmailCalls: number;
  totalLlmCalls: number;
  estimatedLlmCostInr: number;
  gmailSendCostInr: number; // always 0 — sends go through the founder's own account
  totalEstimatedCostInr: number;
}

/**
 * Computes the actual cost to serve one Starter-tier customer (30 investors),
 * so margin isn't a guess.
 */
export function estimateCampaignCost(investorCount: number): CampaignCostBreakdown {
  const deckInterviewCalls = 8; // structured interview turns
  const deckSectionGenerationCalls = 7; // problem, solution, market, traction, team, ask, design pass
  const perInvestorEmailCalls = investorCount; // one personalized generation per investor

  const totalLlmCalls = deckInterviewCalls + deckSectionGenerationCalls + perInvestorEmailCalls;
  const estimatedLlmCostInr = totalLlmCalls * MODEL_COST_PER_CALL_INR;

  return {
    deckInterviewCalls,
    deckSectionGenerationCalls,
    perInvestorEmailCalls,
    totalLlmCalls,
    estimatedLlmCostInr: round2(estimatedLlmCostInr),
    gmailSendCostInr: 0,
    totalEstimatedCostInr: round2(estimatedLlmCostInr),
  };
}

export interface MarginSummary {
  tier: PlanTierId;
  priceInr: number | null;
  estimatedCostInr: number;
  grossMarginInr: number | null;
  grossMarginPercent: number | null;
}

export function computeMargin(tier: PlanTierId, investorCount: number): MarginSummary {
  const price = PRICING_TIERS[tier].priceInr;
  const cost = estimateCampaignCost(investorCount).totalEstimatedCostInr;
  const marginInr = price != null ? price - cost : null;
  return {
    tier,
    priceInr: price,
    estimatedCostInr: round2(cost),
    grossMarginInr: marginInr != null ? round2(marginInr) : null,
    grossMarginPercent: marginInr != null ? round2((marginInr / (price as number)) * 100) : null,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
