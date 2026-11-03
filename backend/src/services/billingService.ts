/**
 * billingService.ts
 *
 * The only code path that turns money into an entitlement. Both the Razorpay webhook and
 * the post-checkout verification call activatePaidOrder(), which:
 *  - looks the order up in OUR invoices table (created server-side at checkout with the
 *    user id and tier) — never trusting user/tier from payment notes, which the browser
 *    can set;
 *  - checks the captured amount against the amount we charged for that order;
 *  - is idempotent (row lock + status check), so a webhook retry, a duplicate event and
 *    the browser's verify call racing each other activate exactly once.
 *
 * Invoice states: CREATED (checkout initiated) → PAID | FAILED | EXPIRED (abandoned >24h);
 * PAID → REFUNDED. A FAILED or EXPIRED order can still become PAID if Razorpay later
 * captures a payment for it (e.g. a delayed UPI confirmation).
 */
import { Queryable } from "../lib/db";
import { createNotification } from "../routes/notifications";
import { PRICING_TIERS, PlanTierId, isPlanTier, planRank, resolveEntitlementTier } from "./pricingService";

export const BILLING_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

export type ActivationOutcome =
  | { status: "activated"; invoiceId: string; tier: PlanTierId; userId: string }
  | { status: "already_paid"; invoiceId: string; tier: PlanTierId; userId: string }
  | { status: "kept_higher_plan"; invoiceId: string; tier: PlanTierId; userId: string }
  | { status: "unknown_order" }
  | { status: "refunded" }
  | { status: "amount_mismatch"; expectedPaise: number; receivedPaise: number };

/** Monthly plans run 30 days from payment; one-time plans (Starter) don't expire. */
export function computePeriodEnd(tier: PlanTierId, now = new Date()): Date | null {
  const info = PRICING_TIERS[tier];
  if (info.billing === "monthly") return new Date(now.getTime() + BILLING_PERIOD_MS);
  return null;
}

/** Must be called inside a transaction (BEGIN … COMMIT) on `db`. */
export async function activatePaidOrder(
  db: Queryable,
  input: { orderId: string; paymentId: string; amountPaise: number },
  now = new Date()
): Promise<ActivationOutcome> {
  const invoice = (await db.query("SELECT * FROM invoices WHERE razorpay_order_id = $1 FOR UPDATE", [input.orderId])).rows[0];
  if (!invoice) return { status: "unknown_order" };
  if (!isPlanTier(invoice.tier)) return { status: "unknown_order" };
  const tier = invoice.tier as PlanTierId;
  if (invoice.status === "REFUNDED") return { status: "refunded" };
  if (invoice.status === "PAID") return { status: "already_paid", invoiceId: invoice.id, tier, userId: invoice.user_id };

  const expectedPaise = invoice.amount_inr * 100;
  if (input.amountPaise !== expectedPaise) {
    await db.query("UPDATE invoices SET failure_reason = $1, updated_at = now() WHERE id = $2", [
      `Amount mismatch: expected ${expectedPaise} paise, received ${input.amountPaise}.`,
      invoice.id,
    ]);
    return { status: "amount_mismatch", expectedPaise, receivedPaise: input.amountPaise };
  }

  await db.query(
    `UPDATE invoices SET status = 'PAID', razorpay_payment_id = $1, paid_at = $2, failure_reason = NULL, updated_at = now() WHERE id = $3`,
    [input.paymentId, now, invoice.id]
  );

  const current = (await db.query("SELECT * FROM subscriptions WHERE user_id = $1 FOR UPDATE", [invoice.user_id])).rows[0];
  const currentTier = resolveEntitlementTier(current, now);
  if (planRank(currentTier) > planRank(tier)) {
    // Checkout refuses this, but if it happens anyway never downgrade a paying customer.
    await createNotification(
      invoice.user_id,
      "payment",
      `Payment received for ${PRICING_TIERS[tier].name}`,
      `You're already on ${PRICING_TIERS[currentTier].name}, so your plan was not changed. Contact support for a refund.`,
      db
    );
    return { status: "kept_higher_plan", invoiceId: invoice.id, tier, userId: invoice.user_id };
  }

  // Renewing the same monthly plan early extends from the current end date instead of
  // throwing away the remaining days.
  let periodEnd = computePeriodEnd(tier, now);
  if (periodEnd && current && currentTier === tier && current.current_period_end && new Date(current.current_period_end) > now) {
    periodEnd = new Date(new Date(current.current_period_end).getTime() + BILLING_PERIOD_MS);
  }

  await db.query(
    `INSERT INTO subscriptions (user_id, tier, status, current_period_start, current_period_end, razorpay_subscription_id, cancel_at_period_end, cancelled_at, source_invoice_id)
     VALUES ($1, $2, 'ACTIVE', $3, $4, NULL, false, NULL, $5)
     ON CONFLICT (user_id) DO UPDATE SET tier = $2, status = 'ACTIVE', current_period_start = $3, current_period_end = $4,
       razorpay_subscription_id = NULL, cancel_at_period_end = false, cancelled_at = NULL, source_invoice_id = $5`,
    [invoice.user_id, tier, now, periodEnd, invoice.id]
  );

  await createNotification(
    invoice.user_id,
    "payment",
    `${PRICING_TIERS[tier].name} plan activated`,
    `Payment of ₹${invoice.amount_inr.toLocaleString("en-IN")} received.${periodEnd ? ` Active until ${periodEnd.toDateString()}.` : ""}`,
    db
  );
  return { status: "activated", invoiceId: invoice.id, tier, userId: invoice.user_id };
}

/** A failed attempt marks the ORDER failed. It never touches an existing subscription. */
export async function markOrderFailed(db: Queryable, orderId: string, reason: string | null | undefined): Promise<boolean> {
  const result = await db.query(
    `UPDATE invoices SET status = 'FAILED', failure_reason = $1, updated_at = now()
     WHERE razorpay_order_id = $2 AND status IN ('CREATED','EXPIRED','FAILED') RETURNING user_id`,
    [(reason || "Payment failed.").slice(0, 500), orderId]
  );
  return result.rows.length > 0;
}

/** A full refund ends the entitlement that payment granted; partial refunds keep the plan. */
export async function markPaymentRefunded(db: Queryable, paymentId: string, refundedPaise: number): Promise<"refunded" | "partial" | "unknown"> {
  const invoice = (await db.query("SELECT * FROM invoices WHERE razorpay_payment_id = $1 FOR UPDATE", [paymentId])).rows[0];
  if (!invoice) return "unknown";
  if (refundedPaise < invoice.amount_inr * 100) return "partial";

  await db.query("UPDATE invoices SET status = 'REFUNDED', refunded_at = now(), updated_at = now() WHERE id = $1", [invoice.id]);
  await db.query(
    "UPDATE subscriptions SET status = 'CANCELLED', cancelled_at = now() WHERE user_id = $1 AND source_invoice_id = $2",
    [invoice.user_id, invoice.id]
  );
  await createNotification(invoice.user_id, "payment", "Refund processed", `₹${invoice.amount_inr.toLocaleString("en-IN")} was refunded.`, db);
  return "refunded";
}
