/**
 * entitlementService.ts
 *
 * One place that answers "what is this founder allowed to do right now, and how much of
 * it have they used?" from real database rows. Campaign creation, dispatch, the quota
 * endpoint and the billing page all read from here, so the number a founder sees is the
 * number the backend enforces.
 */
import { pool, Queryable } from "../lib/db";
import {
  EntitlementTierId,
  PLAN_LIMITS,
  PlanLimits,
  QuotaSummary,
  SubscriptionRecord,
  quotaWindowStart,
  resolveEntitlementTier,
  summarizeQuota,
} from "./pricingService";

export interface AccountEntitlement {
  subscription: (SubscriptionRecord & { cancel_at_period_end?: boolean | null }) | null;
  tier: EntitlementTierId;
  limits: PlanLimits;
  windowStart: Date | null;
  quota: QuotaSummary;
}

export async function loadEntitlement(userId: string, db: Queryable = pool, now = new Date()): Promise<AccountEntitlement> {
  const subscription =
    (
      await db.query(
        "SELECT tier, status, current_period_start, current_period_end, cancel_at_period_end FROM subscriptions WHERE user_id = $1",
        [userId]
      )
    ).rows[0] ?? null;
  const tier = resolveEntitlementTier(subscription, now);
  const limits = PLAN_LIMITS[tier];
  const windowStart = quotaWindowStart(subscription, now);

  // sent: anything that actually left the outbox in this window (REPLIED and BOUNCED rows
  // were sent too — counting only status = 'SENT' let replies free up quota).
  // queued: drafts created in this window still waiting to go out.
  const usage = (
    await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE sent_at IS NOT NULL AND ($2::timestamptz IS NULL OR sent_at >= $2))::int AS sent,
         COUNT(*) FILTER (WHERE status = 'QUEUED' AND ($2::timestamptz IS NULL OR created_at >= $2))::int AS queued
       FROM email_sends WHERE user_id = $1`,
      [userId, windowStart]
    )
  ).rows[0];

  return {
    subscription,
    tier,
    limits,
    windowStart,
    quota: summarizeQuota(limits.investorEmails, { sent: usage.sent, queued: usage.queued }),
  };
}

/** Emails that left this user's outbox since the start of the current UTC day. */
export async function countSentToday(userId: string, db: Queryable = pool): Promise<number> {
  const result = await db.query(
    `SELECT COUNT(*)::int AS count FROM email_sends
     WHERE user_id = $1 AND sent_at IS NOT NULL AND sent_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
    [userId]
  );
  return result.rows[0].count;
}
