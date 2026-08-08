import { Router } from "express";
import Razorpay from "razorpay";
import { pool } from "../lib/db";
import { requireAuth } from "../lib/auth";
import { PRICING_TIERS, computeMargin, PlanTierId } from "../services/pricingService";
import { verifyRazorpaySignature, parseVerifiedWebhook } from "../lib/razorpaySignature";

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
 * Razorpay calls this on payment/subscription events — it's called by Razorpay's servers,
 * not by a logged-in browser, so it must stay OUTSIDE the requireAuth gate below.
 * Signature verification is what protects this route instead of a JWT: an attacker who
 * knows this URL could otherwise POST a fake "payment succeeded" event and unlock a paid
 * campaign for free, so the signature check is the entire security boundary here.
 *
 * This route needs the RAW request body bytes (not Express's parsed JSON) because
 * Razorpay signs the exact bytes it sent — re-serializing parsed JSON can produce
 * byte-different output (key order, whitespace) that fails signature verification even
 * for a legitimate payload. app.ts mounts express.raw() for this exact path before the
 * global express.json() middleware runs, so req.body here is a Buffer, not a parsed object.
 */
billingRouter.post("/webhook", async (req, res) => {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || "";
  const signature = req.headers["x-razorpay-signature"] as string | undefined;
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf-8") : JSON.stringify(req.body ?? {});

  const isValid = verifyRazorpaySignature(rawBody, signature, webhookSecret);
  if (!isValid) {
    console.warn("Rejected Razorpay webhook: invalid or missing signature.");
    return res.status(400).json({ error: "Invalid signature." });
  }

  const event = parseVerifiedWebhook(rawBody);

  if (event.event === "payment.captured") {
    const payment = event.payload.payment?.entity;
    const userId = payment?.notes?.userId;
    const tier = payment?.notes?.tier;
    if (userId && tier) {
      await pool.query(
        `INSERT INTO subscriptions (user_id, tier, status, current_period_end)
         VALUES ($1, $2, 'ACTIVE', CASE WHEN $2 = 'GROWTH' THEN now() + interval '30 days' ELSE NULL END)
         ON CONFLICT (user_id) DO UPDATE SET tier = $2, status = 'ACTIVE'`,
        [userId, tier]
      );
    }
  } else if (event.event === "subscription.cancelled") {
    const subscription = event.payload.subscription?.entity;
    const userId = subscription?.notes?.userId;
    if (userId) {
      await pool.query("UPDATE subscriptions SET status = 'CANCELLED' WHERE user_id = $1", [userId]);
    }
  }

  res.status(200).json({ received: true });
});

// ---------- Everything below requires a logged-in founder ----------
billingRouter.use(requireAuth);

/**
 * Creates a real Razorpay order and returns what the frontend needs to launch Razorpay
 * Checkout (order_id + key_id). The order carries `notes: { userId, tier }` so the
 * webhook above can identify which user/tier to activate on payment.captured — this is
 * the standard Razorpay pattern for connecting a webhook event back to your own records
 * without trusting anything the frontend claims about payment success.
 */
billingRouter.post("/checkout", async (req, res) => {
  const { tier } = req.body as { tier?: string };
  if (!tier || !(tier in PRICING_TIERS)) {
    return res.status(400).json({ error: "Invalid tier." });
  }
  const userId = req.auth!.userId;
  const tierInfo = PRICING_TIERS[tier as PlanTierId];
  const razorpay = getRazorpayClient();

  if (!razorpay) {
    return res.status(200).json({
      mocked: true,
      notice: "Razorpay not configured — add RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET to .env to enable real checkout.",
      tier: tierInfo,
    });
  }

  const amountPaise = tierInfo.priceInr * 100; // Razorpay amounts are always in the smallest currency unit

  const order = await razorpay.orders.create({
    amount: amountPaise,
    currency: "INR",
    notes: { userId, tier },
    receipt: `gopitch_${userId.slice(0, 8)}_${Date.now()}`,
  });

  await pool.query(
    `INSERT INTO invoices (user_id, razorpay_order_id, tier, amount_inr, status)
     VALUES ($1, $2, $3, $4, 'CREATED')`,
    [userId, order.id, tier, tierInfo.priceInr]
  );

  res.json({
    mocked: false,
    orderId: order.id,
    amountPaise,
    currency: "INR",
    keyId: process.env.RAZORPAY_KEY_ID,
    tier: tierInfo,
  });
});

/** Founder's own invoice/payment history. */
billingRouter.get("/invoices", async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM invoices WHERE user_id = $1 ORDER BY created_at DESC",
    [req.auth!.userId]
  );
  res.json(
    result.rows.map((r) => ({
      id: r.id,
      tier: r.tier,
      amountInr: r.amount_inr,
      status: r.status,
      razorpayOrderId: r.razorpay_order_id,
      razorpayPaymentId: r.razorpay_payment_id,
      createdAt: r.created_at,
    }))
  );
});

/** Current subscription status for the founder's billing page. */
billingRouter.get("/subscription", async (req, res) => {
  const result = await pool.query("SELECT * FROM subscriptions WHERE user_id = $1", [req.auth!.userId]);
  const sub = result.rows[0];
  if (!sub) return res.json({ tier: null, status: null });
  res.json({
    tier: sub.tier,
    status: sub.status,
    currentPeriodEnd: sub.current_period_end,
  });
});

/** Internal — lets admins/founders see the real margin math, matches pricingService tests. */
billingRouter.get("/margin-preview", (req, res) => {
  const tier = (req.query.tier as string) || "STARTER";
  const investorCount = Number(req.query.investorCount) || 30;
  if (!(tier in PRICING_TIERS)) return res.status(400).json({ error: "Invalid tier." });
  res.json(computeMargin(tier as keyof typeof PRICING_TIERS, investorCount));
});
