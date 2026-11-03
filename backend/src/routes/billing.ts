import { Router } from "express";
import * as crypto from "crypto";
import Razorpay from "razorpay";
import { pool } from "../lib/db";
import { requireAuth, requireAdmin } from "../lib/auth";
import { PRICING_TIERS, computeMargin, PlanTierId, planRank, resolveEntitlementTier } from "../services/pricingService";
import { verifyRazorpaySignature, verifyCheckoutSignature, parseVerifiedWebhook } from "../lib/razorpaySignature";
import { activatePaidOrder, markOrderFailed, markPaymentRefunded, ActivationOutcome } from "../services/billingService";

export const billingRouter = Router();

function getRazorpayClient(): Razorpay | null {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) return null;
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
}

/** Public — pricing page reads this, no auth required. */
billingRouter.get("/pricing", (_req, res) => {
  res.json(Object.values(PRICING_TIERS));
});

/**
 * Razorpay calls this on payment events. It's outside requireAuth; the HMAC signature over
 * the raw body is the security boundary (app.ts mounts express.raw() for this path).
 *
 * Idempotency: the event id is recorded in the SAME transaction as the state change, so a
 * failure rolls both back and Razorpay's retry is processed rather than skipped as a
 * "duplicate" (previously the id was recorded before processing, so one transient DB error
 * silently lost the payment). There is no timestamp window: Razorpay retries failed
 * deliveries for up to 24h, and replay of a signed event is harmless because of the
 * idempotency record.
 */
billingRouter.post("/webhook", async (req, res) => {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || "";
  const signature = req.headers["x-razorpay-signature"] as string | undefined;
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf-8") : "";

  if (!rawBody || !verifyRazorpaySignature(rawBody, signature, webhookSecret)) {
    return res.status(400).json({ error: "Invalid signature." });
  }

  let event;
  try {
    event = parseVerifiedWebhook(rawBody);
  } catch {
    return res.status(400).json({ error: "Malformed payload." });
  }
  const eventId =
    (req.headers["x-razorpay-event-id"] as string | undefined) || crypto.createHash("sha256").update(rawBody).digest("hex");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const fresh = await client.query(
      "INSERT INTO processed_webhook_events (event_id, event_type) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [eventId, event.event]
    );
    if (fresh.rowCount !== 1) {
      await client.query("COMMIT");
      return res.status(200).json({ received: true, duplicate: true });
    }

    let outcome: string = "ignored";
    const payment = event.payload?.payment?.entity;

    if (event.event === "payment.captured" || event.event === "order.paid") {
      const orderId = event.payload?.order?.entity?.id || payment?.order_id;
      if (orderId && payment?.id && typeof payment.amount === "number") {
        const result: ActivationOutcome = await activatePaidOrder(client, { orderId, paymentId: payment.id, amountPaise: payment.amount });
        outcome = result.status;
        if (result.status === "amount_mismatch") console.error(`Razorpay amount mismatch on ${orderId}`, result);
      }
    } else if (event.event === "payment.failed") {
      if (payment?.order_id) outcome = (await markOrderFailed(client, payment.order_id, payment.error_description)) ? "failed" : "ignored";
    } else if (event.event === "refund.processed") {
      const refund = event.payload?.refund?.entity;
      if (refund?.payment_id) outcome = await markPaymentRefunded(client, refund.payment_id, refund.amount);
    } else if (event.event === "subscription.cancelled" || event.event === "subscription.completed" || event.event === "subscription.expired") {
      // Only relevant if Razorpay Subscriptions are adopted later; matched by OUR stored id.
      const sub = event.payload?.subscription?.entity;
      if (sub?.id) {
        await client.query("UPDATE subscriptions SET status = 'CANCELLED', cancelled_at = now() WHERE razorpay_subscription_id = $1", [sub.id]);
        outcome = "subscription_closed";
      }
    }

    await client.query("COMMIT");
    res.status(200).json({ received: true, outcome });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Webhook processing error:", (err as Error).message);
    res.status(500).json({ error: "Webhook processing failed." });
  } finally {
    client.release();
  }
});

// ---------- Everything below requires a logged-in founder ----------
billingRouter.use(requireAuth);

/** Effective plan for the billing UI: what the founder is entitled to right now. */
async function loadSubscriptionView(userId: string) {
  const sub = (await pool.query("SELECT * FROM subscriptions WHERE user_id = $1", [userId])).rows[0];
  const entitlementTier = resolveEntitlementTier(sub);
  return {
    entitlementTier,
    tier: sub?.tier ?? null,
    status: sub?.status ?? null,
    isPaidActive: entitlementTier !== "FREE",
    billing: entitlementTier !== "FREE" ? PRICING_TIERS[entitlementTier].billing : null,
    currentPeriodStart: sub?.current_period_start ?? null,
    currentPeriodEnd: sub?.current_period_end ?? null,
    cancelAtPeriodEnd: sub?.cancel_at_period_end ?? false,
    cancelledAt: sub?.cancelled_at ?? null,
    // A plan that lapsed (expired / cancelled / refunded) — the UI explains why the account is on Free.
    lapsed: !!sub && entitlementTier === "FREE",
  };
}

/**
 * Creates a real Razorpay order and an invoice row (status CREATED = payment initiated,
 * not completed). The invoice is what later ties a captured payment to this user and tier.
 */
billingRouter.post("/checkout", async (req, res) => {
  const { tier } = req.body as { tier?: string };
  if (tier !== "STARTER" && tier !== "GROWTH") {
    return res.status(400).json({
      error: tier === "ENTERPRISE" ? "Enterprise is quoted individually — use Talk to Sales." : "Choose the Starter or Growth plan.",
    });
  }
  const userId = req.auth!.userId;
  const tierInfo = PRICING_TIERS[tier as PlanTierId];

  const current = await loadSubscriptionView(userId);
  if (planRank(current.entitlementTier) > planRank(tier as PlanTierId)) {
    return res.status(409).json({ error: `You're already on ${PRICING_TIERS[current.entitlementTier].name}, which includes everything in ${tierInfo.name}.` });
  }

  const razorpay = getRazorpayClient();
  if (!razorpay) {
    return res.status(503).json({ error: "Payments aren't configured on this server yet. Please try again later." });
  }

  const amountPaise = tierInfo.priceInr! * 100; // Razorpay amounts are in the smallest currency unit
  const order = await razorpay.orders.create({
    amount: amountPaise,
    currency: "INR",
    notes: { userId, tier },
    receipt: `gp_${userId.slice(0, 8)}_${Date.now()}`,
  });

  await pool.query(
    `INSERT INTO invoices (user_id, razorpay_order_id, tier, amount_inr, status) VALUES ($1, $2, $3, $4, 'CREATED')`,
    [userId, order.id, tier, tierInfo.priceInr]
  );

  res.json({
    orderId: order.id,
    amountPaise,
    currency: "INR",
    keyId: process.env.RAZORPAY_KEY_ID,
    tier: tierInfo,
  });
});

/**
 * Called by the browser after Razorpay Checkout's success handler. The checkout signature
 * proves the payment belongs to our order; the payment is then fetched from Razorpay to
 * confirm it's actually captured before anything is activated. A frontend "success"
 * message alone never activates a plan. If the payment is only authorized (or Razorpay is
 * unreachable) the answer is "pending" and the webhook completes activation.
 */
billingRouter.post("/verify", async (req, res) => {
  const { orderId, paymentId, signature } = req.body as { orderId?: string; paymentId?: string; signature?: string };
  const keySecret = process.env.RAZORPAY_KEY_SECRET || "";
  if (!orderId || !paymentId || !verifyCheckoutSignature(orderId, paymentId, signature, keySecret)) {
    return res.status(400).json({ error: "Payment verification failed." });
  }

  const userId = req.auth!.userId;
  const invoice = (await pool.query("SELECT user_id FROM invoices WHERE razorpay_order_id = $1", [orderId])).rows[0];
  if (!invoice || invoice.user_id !== userId) return res.status(404).json({ error: "Order not found." });

  const razorpay = getRazorpayClient();
  let payment: any = null;
  try {
    payment = await razorpay!.payments.fetch(paymentId);
  } catch (err) {
    console.warn("Razorpay payment fetch failed:", (err as Error).message);
  }
  if (!payment || payment.order_id !== orderId || payment.status !== "captured") {
    return res.status(202).json({ status: "pending", subscription: await loadSubscriptionView(userId) });
  }

  const client = await pool.connect();
  let outcome: ActivationOutcome;
  try {
    await client.query("BEGIN");
    outcome = await activatePaidOrder(client, { orderId, paymentId, amountPaise: Number(payment.amount) });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  if (outcome.status === "amount_mismatch" || outcome.status === "unknown_order" || outcome.status === "refunded") {
    return res.status(409).json({ error: "This payment couldn't be applied to your account. Contact support.", status: outcome.status });
  }
  res.json({ status: outcome.status, subscription: await loadSubscriptionView(userId) });
});

/** Founder's own invoice/payment history. Orders abandoned for 24h are shown as EXPIRED. */
billingRouter.get("/invoices", async (req, res) => {
  const userId = req.auth!.userId;
  await pool.query(
    "UPDATE invoices SET status = 'EXPIRED', updated_at = now() WHERE user_id = $1 AND status = 'CREATED' AND created_at < now() - interval '24 hours'",
    [userId]
  );
  const result = await pool.query("SELECT * FROM invoices WHERE user_id = $1 ORDER BY created_at DESC", [userId]);
  res.json(
    result.rows.map((r) => ({
      id: r.id,
      tier: r.tier,
      amountInr: r.amount_inr,
      status: r.status,
      failureReason: r.failure_reason ?? null,
      razorpayOrderId: r.razorpay_order_id,
      razorpayPaymentId: r.razorpay_payment_id,
      paidAt: r.paid_at ?? null,
      createdAt: r.created_at,
    }))
  );
});

billingRouter.get("/subscription", async (req, res) => {
  res.json(await loadSubscriptionView(req.auth!.userId));
});

/**
 * Cancels renewal. Plans are bought as one-off Razorpay orders (nothing auto-charges), so
 * cancelling means: keep the paid period the founder already paid for, then fall back to
 * Free at current_period_end. One-time purchases (Starter) have nothing to cancel.
 */
billingRouter.post("/cancel", async (req, res) => {
  const userId = req.auth!.userId;
  const view = await loadSubscriptionView(userId);
  if (!view.isPaidActive) return res.status(404).json({ error: "You don't have an active paid plan." });
  if (!view.currentPeriodEnd) {
    return res.status(400).json({ error: "Starter is a one-time purchase — there's no renewal to cancel. Contact support about refunds." });
  }
  if (view.cancelAtPeriodEnd) return res.status(409).json({ error: "Your plan is already set to end at the close of this period." });

  await pool.query("UPDATE subscriptions SET cancel_at_period_end = true, cancelled_at = now() WHERE user_id = $1", [userId]);
  res.json({ ok: true, subscription: await loadSubscriptionView(userId) });
});

/** Internal unit economics — admins only (it exposes cost assumptions). */
billingRouter.get("/margin-preview", requireAdmin, (req, res) => {
  const tier = (req.query.tier as string) || "STARTER";
  const investorCount = Number(req.query.investorCount) || 30;
  if (!(tier in PRICING_TIERS)) return res.status(400).json({ error: "Invalid tier." });
  const tierInfo = PRICING_TIERS[tier as keyof typeof PRICING_TIERS];
  if (tierInfo.priceInr == null) {
    return res.status(200).json({ error: "Custom pricing tier — margin preview not available." });
  }
  res.json(computeMargin(tier as keyof typeof PRICING_TIERS, investorCount));
});
