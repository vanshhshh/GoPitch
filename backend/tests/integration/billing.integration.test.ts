/**
 * Billing lifecycle against real SQL. Razorpay's API is mocked; webhooks are signed with
 * the test webhook secret exactly as Razorpay signs them. No real payment is made.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import * as crypto from "crypto";
import type { Express } from "express";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const { ordersCreate, paymentsFetch, activationFault } = vi.hoisted(() => ({
  ordersCreate: vi.fn(),
  paymentsFetch: vi.fn(),
  activationFault: { failNext: false },
}));

vi.mock("../../src/lib/db", async () => await import("./testDb"));
vi.mock("razorpay", () => ({
  default: class {
    orders = { create: ordersCreate };
    payments = { fetch: paymentsFetch };
  },
}));
vi.mock("../../src/services/billingService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/billingService")>();
  return {
    ...actual,
    activatePaidOrder: async (...args: Parameters<typeof actual.activatePaidOrder>) => {
      if (activationFault.failNext) {
        activationFault.failNext = false;
        throw new Error("simulated transient DB failure");
      }
      return actual.activatePaidOrder(...args);
    },
  };
});

import { applyTestEnv, api, createUser, setSubscription, TEST_ENV } from "./helpers";
import { pool, getTestDb } from "./testDb";

let client: ReturnType<typeof api>;
let signToken: (p: any) => string;
let orderSeq = 0;

beforeAll(async () => {
  applyTestEnv();
  await getTestDb();
  const app: Express = (await import("../../src/app")).app;
  signToken = (await import("../../src/lib/auth")).signToken;
  client = api(app);
}, 120_000);

beforeEach(() => {
  ordersCreate.mockReset();
  ordersCreate.mockImplementation(async (opts: any) => ({ id: `order_${++orderSeq}`, amount: opts.amount }));
  paymentsFetch.mockReset();
});

function webhook(body: object, eventId = `evt_${Math.random().toString(36).slice(2)}`, secret = TEST_ENV.RAZORPAY_WEBHOOK_SECRET) {
  const raw = JSON.stringify(body);
  const signature = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  return client
    .post("/api/billing/webhook")
    .set("Content-Type", "application/json")
    .set("X-Razorpay-Signature", signature)
    .set("X-Razorpay-Event-Id", eventId)
    .send(raw);
}

function captured(orderId: string, amountPaise: number, paymentId = `pay_${Math.random().toString(36).slice(2)}`, notes: Record<string, string> = {}) {
  return { event: "payment.captured", payload: { payment: { entity: { id: paymentId, order_id: orderId, status: "captured", amount: amountPaise, notes } } } };
}

async function checkout(token: string, tier: string) {
  const res = await client.post("/api/billing/checkout", token).send({ tier });
  return res;
}

describe("pricing", () => {
  it("publishes the agreed prices", async () => {
    const tiers = (await client.get("/api/billing/pricing")).body;
    const byId = Object.fromEntries(tiers.map((t: any) => [t.id, t]));
    expect(byId.STARTER.priceInr).toBe(4499);
    expect(byId.GROWTH.priceInr).toBe(11999);
    expect(byId.ENTERPRISE.priceInr).toBeNull();
    expect(byId.ENTERPRISE.priceNote).toMatch(/30,000/);
  });
});

describe("checkout → webhook → activation", () => {
  it("an initiated checkout is not a payment; a signed capture activates exactly once", async () => {
    const u = await createUser(signToken);
    const co = await checkout(u.token, "STARTER");
    expect(co.status).toBe(200);
    expect(co.body.amountPaise).toBe(449900);

    let sub = (await client.get("/api/billing/subscription", u.token)).body;
    expect(sub.entitlementTier).toBe("FREE");
    expect((await client.get("/api/billing/invoices", u.token)).body[0].status).toBe("CREATED");

    const event = captured(co.body.orderId, 449900);
    const first = await webhook(event, "evt_once");
    expect(first.body.outcome).toBe("activated");
    const dup = await webhook(event, "evt_once");
    expect(dup.body.duplicate).toBe(true);
    const redelivered = await webhook(event, "evt_other_id");
    expect(redelivered.body.outcome).toBe("already_paid");

    sub = (await client.get("/api/billing/subscription", u.token)).body;
    expect(sub).toMatchObject({ entitlementTier: "STARTER", isPaidActive: true, currentPeriodEnd: null });
    expect((await client.get("/api/billing/invoices", u.token)).body[0].status).toBe("PAID");
    const notes = (await client.get("/api/notifications", u.token)).body.filter((n: any) => n.type === "payment");
    expect(notes).toHaveLength(1);
  });

  it("rejects unsigned and tampered webhooks", async () => {
    const u = await createUser(signToken);
    const co = await checkout(u.token, "GROWTH");
    expect((await webhook(captured(co.body.orderId, 1199900), undefined, "wrong-secret")).status).toBe(400);
    expect((await client.post("/api/billing/webhook").set("Content-Type", "application/json").send(JSON.stringify(captured(co.body.orderId, 1199900)))).status).toBe(400);
    expect((await client.get("/api/billing/subscription", u.token)).body.entitlementTier).toBe("FREE");
  });

  it("ignores user/tier in payment notes — the order's owner and tier come from our invoice", async () => {
    const payer = await createUser(signToken);
    const other = await createUser(signToken);
    const co = await checkout(payer.token, "STARTER");
    await webhook(captured(co.body.orderId, 449900, undefined, { userId: other.id, tier: "ENTERPRISE" }));
    expect((await client.get("/api/billing/subscription", payer.token)).body.entitlementTier).toBe("STARTER");
    expect((await client.get("/api/billing/subscription", other.token)).body.entitlementTier).toBe("FREE");
  });

  it("does not activate on an amount mismatch", async () => {
    const u = await createUser(signToken);
    const co = await checkout(u.token, "GROWTH");
    const res = await webhook(captured(co.body.orderId, 100));
    expect(res.body.outcome).toBe("amount_mismatch");
    expect((await client.get("/api/billing/subscription", u.token)).body.entitlementTier).toBe("FREE");
  });

  it("a failed payment attempt never downgrades an active subscriber (regression: used to set PAST_DUE)", async () => {
    const u = await createUser(signToken);
    await setSubscription(u.id, "GROWTH", { periodEndDays: 20 });
    const co = await checkout(u.token, "GROWTH"); // renewal attempt
    const failed = await webhook({ event: "payment.failed", payload: { payment: { entity: { id: "pay_f", order_id: co.body.orderId, status: "failed", amount: 1199900, error_description: "Card declined" } } } });
    expect(failed.body.outcome).toBe("failed");
    expect((await client.get("/api/billing/subscription", u.token)).body).toMatchObject({ entitlementTier: "GROWTH", status: "ACTIVE" });
    const inv = (await client.get("/api/billing/invoices", u.token)).body[0];
    expect(inv).toMatchObject({ status: "FAILED", failureReason: "Card declined" });

    // A later successful capture on the same order still activates (late UPI confirmation).
    expect((await webhook(captured(co.body.orderId, 1199900))).body.outcome).toBe("activated");
  });

  it("early renewal extends from the current period end instead of discarding remaining days", async () => {
    const u = await createUser(signToken);
    await setSubscription(u.id, "GROWTH", { periodEndDays: 10 });
    const before = new Date((await client.get("/api/billing/subscription", u.token)).body.currentPeriodEnd).getTime();
    const co = await checkout(u.token, "GROWTH");
    await webhook(captured(co.body.orderId, 1199900));
    const after = new Date((await client.get("/api/billing/subscription", u.token)).body.currentPeriodEnd).getTime();
    expect(Math.round((after - before) / 86_400_000)).toBe(30);
  });

  it("is retried, not lost, when processing fails after the event arrives", async () => {
    const u = await createUser(signToken);
    const co = await checkout(u.token, "STARTER");
    const event = captured(co.body.orderId, 449900);
    activationFault.failNext = true;
    expect((await webhook(event, "evt_retry")).status).toBe(500);
    const retry = await webhook(event, "evt_retry"); // Razorpay redelivers the same event id
    expect(retry.body).toMatchObject({ received: true, outcome: "activated" });
  });

  it("refuses to sell a lower plan over a higher active one, and Enterprise via checkout", async () => {
    const u = await createUser(signToken);
    await setSubscription(u.id, "GROWTH", { periodEndDays: 10 });
    expect((await checkout(u.token, "STARTER")).status).toBe(409);
    expect((await checkout(u.token, "ENTERPRISE")).status).toBe(400);
    expect((await checkout(u.token, "FREE")).status).toBe(400);
  });
});

describe("browser verification after checkout", () => {
  function sign(orderId: string, paymentId: string) {
    return crypto.createHmac("sha256", TEST_ENV.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex");
  }

  it("activates only after confirming capture with Razorpay; pending when only authorized", async () => {
    const u = await createUser(signToken);
    const co = await checkout(u.token, "STARTER");

    expect((await client.post("/api/billing/verify", u.token).send({ orderId: co.body.orderId, paymentId: "pay_x", signature: "00" })).status).toBe(400);

    paymentsFetch.mockResolvedValueOnce({ id: "pay_x", order_id: co.body.orderId, status: "authorized", amount: 449900 });
    const pending = await client.post("/api/billing/verify", u.token).send({ orderId: co.body.orderId, paymentId: "pay_x", signature: sign(co.body.orderId, "pay_x") });
    expect(pending.status).toBe(202);
    expect(pending.body.subscription.entitlementTier).toBe("FREE");

    paymentsFetch.mockResolvedValueOnce({ id: "pay_x", order_id: co.body.orderId, status: "captured", amount: 449900 });
    const ok = await client.post("/api/billing/verify", u.token).send({ orderId: co.body.orderId, paymentId: "pay_x", signature: sign(co.body.orderId, "pay_x") });
    expect(ok.body.status).toBe("activated");
    // The webhook arriving afterwards is a no-op.
    expect((await webhook(captured(co.body.orderId, 449900, "pay_x"))).body.outcome).toBe("already_paid");
  });

  it("won't verify another user's order", async () => {
    const owner = await createUser(signToken);
    const thief = await createUser(signToken);
    const co = await checkout(owner.token, "STARTER");
    const res = await client.post("/api/billing/verify", thief.token).send({ orderId: co.body.orderId, paymentId: "pay_y", signature: sign(co.body.orderId, "pay_y") });
    expect(res.status).toBe(404);
  });
});

describe("refunds, cancellation and expiry", () => {
  it("a full refund ends the plan that payment granted", async () => {
    const u = await createUser(signToken);
    const co = await checkout(u.token, "STARTER");
    await webhook(captured(co.body.orderId, 449900, "pay_refund_me"));
    const refund = await webhook({ event: "refund.processed", payload: { refund: { entity: { id: "rfnd_1", payment_id: "pay_refund_me", amount: 449900, status: "processed" } } } });
    expect(refund.body.outcome).toBe("refunded");
    expect((await client.get("/api/billing/subscription", u.token)).body).toMatchObject({ entitlementTier: "FREE", lapsed: true });
    expect((await client.get("/api/billing/invoices", u.token)).body[0].status).toBe("REFUNDED");
  });

  it("cancelling Growth keeps access until the paid period ends; Starter has nothing to cancel", async () => {
    const g = await createUser(signToken);
    await setSubscription(g.id, "GROWTH", { periodEndDays: 12 });
    const cancel = await client.post("/api/billing/cancel", g.token).send({});
    expect(cancel.body.subscription).toMatchObject({ entitlementTier: "GROWTH", cancelAtPeriodEnd: true });
    expect((await client.post("/api/billing/cancel", g.token).send({})).status).toBe(409);
    await pool.query("UPDATE subscriptions SET current_period_end = now() - interval '1 second' WHERE user_id = $1", [g.id]);
    expect((await client.get("/api/billing/subscription", g.token)).body.entitlementTier).toBe("FREE");

    const s = await createUser(signToken);
    await setSubscription(s.id, "STARTER", { periodEndDays: null });
    expect((await client.post("/api/billing/cancel", s.token).send({})).status).toBe(400);
    const free = await createUser(signToken);
    expect((await client.post("/api/billing/cancel", free.token).send({})).status).toBe(404);
  });

  it("marks checkouts abandoned for over 24h as EXPIRED", async () => {
    const u = await createUser(signToken);
    const co = await checkout(u.token, "STARTER");
    await pool.query("UPDATE invoices SET created_at = now() - interval '25 hours' WHERE razorpay_order_id = $1", [co.body.orderId]);
    expect((await client.get("/api/billing/invoices", u.token)).body[0].status).toBe("EXPIRED");
  });

  it("keeps cost/margin internals admin-only", async () => {
    const u = await createUser(signToken);
    expect((await client.get("/api/billing/margin-preview", u.token)).status).toBe(403);
  });
});

describe("migrations", () => {
  it("are idempotent: re-applying every migration on a migrated database changes nothing", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const { applySchemaAndMigrations } = await import("./testDb");
    const fresh = new PGlite();
    await applySchemaAndMigrations(fresh, 2);
    const constraint = await fresh.query<any>("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'campaigns_tier_check'");
    expect(constraint.rows[0].def).toContain("FREE");
    await fresh.close();
  });
});
