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
  /** Shown instead of a price for custom-quote tiers. */
  priceNote?: string;
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
    priceInr: 4499,
    billing: "one_time",
    includes: [
      "AI-guided deck creation (interview + screenshots + founder history), or upload your own deck",
      "Curated, scored list of up to 100 best-fit investors from the verified database",
      "Up to 100 fully personalized outreach emails, ready to review and send",
      "Sends from your own Gmail at a safe warm-up rate",
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
      "Full daily send cap (150/day) once your Gmail has warmed up",
      "Investor list expands automatically as new verified contacts are added",
    ],
  },
  ENTERPRISE: {
    id: "ENTERPRISE",
    name: "Enterprise",
    priceInr: null,
    billing: "monthly",
    priceNote: "Custom quote · typically from ₹30,000–₹35,000",
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
  /** Total outreach emails per quota window (lifetime for FREE, per purchase/period for paid). */
  investorEmails: number;
  activeCampaigns: number | null;
}

// Daily send caps are NOT per plan: every account follows the same warm-up ramp in
// sendScheduler.ts (50/day for the first 3 days after Gmail is connected, then 150/day).
export const PLAN_LIMITS: Record<EntitlementTierId, PlanLimits> = {
  FREE: { investorEmails: 30, activeCampaigns: 1 },
  STARTER: { investorEmails: 100, activeCampaigns: null },
  GROWTH: { investorEmails: 500, activeCampaigns: null },
  ENTERPRISE: {
    investorEmails: Number(process.env.ENTERPRISE_INVESTOR_EMAIL_LIMIT || 2000),
    activeCampaigns: process.env.ENTERPRISE_ACTIVE_CAMPAIGN_LIMIT
      ? Number(process.env.ENTERPRISE_ACTIVE_CAMPAIGN_LIMIT)
      : null,
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
  current_period_start?: Date | string | null;
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

/**
 * The campaign tier is always the founder's actual entitlement, derived server-side from
 * their subscription. A client may optionally state the tier it expects (e.g. the plan
 * shown on screen); if that is higher than what they are entitled to, the request is
 * refused instead of silently downgraded or — as previously happened for FREE accounts —
 * silently relabelled as STARTER.
 */
export function authorizeCampaignTier(
  subscription: SubscriptionRecord | null | undefined,
  requestedTier?: EntitlementTierId | null,
  now = new Date()
): CampaignTierAuthorization {
  const entitlementTier = resolveEntitlementTier(subscription, now);
  const limits = PLAN_LIMITS[entitlementTier];
  const base = {
    entitlementTier,
    investorLimit: limits.investorEmails,
    activeCampaignLimit: limits.activeCampaigns,
  };

  if (requestedTier && PLAN_RANK[requestedTier] > PLAN_RANK[entitlementTier]) {
    return {
      ...base,
      allowed: false,
      reason:
        entitlementTier === "FREE"
          ? `Upgrade required: your account is on the Free plan, not ${PRICING_TIERS[requestedTier].name}.`
          : `Your current ${PRICING_TIERS[entitlementTier].name} plan does not include ${PRICING_TIERS[requestedTier].name} campaigns.`,
    };
  }

  return { ...base, allowed: true };
}

export function isPlanTier(tier: unknown): tier is Exclude<PlanTierId, "FREE"> {
  return tier === "STARTER" || tier === "GROWTH" || tier === "ENTERPRISE";
}

export function planRank(tier: EntitlementTierId): number {
  return PLAN_RANK[tier];
}

/**
 * Start of the window in which outreach emails count against the plan's investorEmails
 * allowance. FREE is a lifetime allowance (null = count everything), so signing out,
 * refreshing, or creating more campaigns can never reset it. A paid plan's allowance
 * starts when the paid period started (a new Starter purchase or Growth renewal grants a
 * fresh allowance).
 */
export function quotaWindowStart(
  subscription: SubscriptionRecord | null | undefined,
  now = new Date()
): Date | null {
  const tier = resolveEntitlementTier(subscription, now);
  if (tier === "FREE" || !subscription?.current_period_start) return null;
  return new Date(subscription.current_period_start);
}

export interface UsageCounts {
  /** Emails that actually left the founder's outbox (sent_at set) — includes later REPLIED/BOUNCED. */
  sent: number;
  /** Drafts still waiting to be sent. */
  queued: number;
}

export interface QuotaSummary {
  limit: number;
  sent: number;
  queued: number;
  /** Allowance not yet consumed by sent emails. */
  remainingToSend: number;
  /** Allowance not yet claimed by sent OR queued emails — what a new campaign may draft. */
  remainingToAllocate: number;
  exhausted: boolean;
}

export function summarizeQuota(limit: number, usage: UsageCounts): QuotaSummary {
  const remainingToSend = Math.max(0, limit - usage.sent);
  const remainingToAllocate = Math.max(0, limit - usage.sent - usage.queued);
  return {
    limit,
    sent: usage.sent,
    queued: usage.queued,
    remainingToSend,
    remainingToAllocate,
    exhausted: remainingToSend === 0,
  };
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
