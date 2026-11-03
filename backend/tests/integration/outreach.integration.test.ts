/**
 * End-to-end API journey against real SQL (PGlite): signup → company → matching →
 * campaign → dispatch → outreach counts, plus the plan, warm-up and isolation rules.
 * External services are mocked: AI generation, Gmail delivery. No real email is sent.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
import type { Express } from "express";

const { deliverEmail, generatePersonalizedEmail } = vi.hoisted(() => ({
  deliverEmail: vi.fn(),
  generatePersonalizedEmail: vi.fn(),
}));

vi.mock("../../src/lib/db", async () => await import("./testDb"));
vi.mock("../../src/lib/emailDelivery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/emailDelivery")>()),
  deliverEmail,
}));
vi.mock("../../src/lib/llmService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/llmService")>()),
  generatePersonalizedEmail,
  isAIFeatureAvailable: () => true,
}));

import { applyTestEnv, api, createUser, createCompany, seedInvestors, connectGmail, setSubscription } from "./helpers";
import { pool, getTestDb } from "./testDb";

let app: Express;
let client: ReturnType<typeof api>;
let signToken: (p: any) => string;
let encrypted: string;

beforeAll(async () => {
  applyTestEnv();
  await getTestDb();
  app = (await import("../../src/app")).app;
  signToken = (await import("../../src/lib/auth")).signToken;
  encrypted = (await import("../../src/lib/tokenEncryption")).encryptToken("refresh-token-for-tests");
  client = api(app);
}, 120_000);

beforeEach(async () => {
  deliverEmail.mockReset();
  deliverEmail.mockImplementation(async () => ({ delivered: true, via: "gmail_api", messageId: `m_${Math.random()}`, threadId: `t_${Math.random()}` }));
  generatePersonalizedEmail.mockReset();
  generatePersonalizedEmail.mockImplementation(async (i: any) => ({
    subject: `${i.companyName} <> ${i.investorFirm}`,
    body: `Hi ${i.investorName}, quick intro.`,
    provider: "mock",
  }));
  // Fresh investor pool per test so "already contacted" state doesn't leak between tests.
  await pool.query("DELETE FROM email_sends");
  await pool.query("DELETE FROM campaigns");
  await pool.query("DELETE FROM investors");
});

describe("auth", () => {
  it("signs up, rejects duplicates and weak passwords, logs in, and reports onboarding state", async () => {
    const weak = await client.post("/api/auth/signup").send({ email: "weak@example.com", password: "password", name: "W" });
    expect(weak.status).toBe(400);
    expect(weak.body.error).toMatch(/letter and one number/);

    const signup = await client.post("/api/auth/signup").send({ email: "Founder@Example.com", password: "s3cretpass", name: "Asha" });
    expect(signup.status).toBe(201);
    expect(signup.body.user.hasCompany).toBe(false);

    const dup = await client.post("/api/auth/signup").send({ email: "founder@example.com", password: "s3cretpass", name: "Asha" });
    expect(dup.status).toBe(409);

    const bad = await client.post("/api/auth/login").send({ email: "founder@example.com", password: "wrongpass1" });
    expect(bad.status).toBe(401);

    const login = await client.post("/api/auth/login").send({ email: "founder@example.com", password: "s3cretpass" });
    expect(login.status).toBe(200);
    const me = await client.get("/api/auth/me", login.body.token);
    expect(me.body).toMatchObject({ email: "founder@example.com", hasCompany: false });
  });

  it("rejects missing, malformed and forged tokens on protected routes", async () => {
    expect((await client.get("/api/companies")).status).toBe(401);
    expect((await client.get("/api/companies", "not-a-jwt")).status).toBe(401);
    const jwt = (await import("jsonwebtoken")).default;
    const forged = jwt.sign({ userId: "x", role: "ADMIN" }, "wrong-secret");
    expect((await client.get("/api/admin/metrics", forged)).status).toBe(401);
  });

  it("re-checks admin role in the database (a demoted admin's token stops working)", async () => {
    const admin = await createUser(signToken, { role: "ADMIN" });
    expect((await client.get("/api/admin/metrics", admin.token)).status).toBe(200);
    await pool.query("UPDATE users SET role = 'FOUNDER' WHERE id = $1", [admin.id]);
    expect((await client.get("/api/admin/metrics", admin.token)).status).toBe(403);
  });

  it("returns 400 (not 500) for malformed JSON bodies", async () => {
    const res = await client.post("/api/auth/login").set("Content-Type", "application/json").send("{bad json");
    expect(res.status).toBe(400);
  });
});

describe("tenant isolation", () => {
  it("never exposes another founder's company, matches, campaigns or sends", async () => {
    await seedInvestors(10);
    const a = await createUser(signToken);
    const b = await createUser(signToken);
    const companyA = await createCompany(a.id);
    const created = await client.post("/api/campaigns", a.token).send({ companyId: companyA, launch: true });
    expect(created.status).toBe(201);
    const campaignA = created.body.campaign.id;
    const sendA = created.body.drafts[0].id;

    expect((await client.get(`/api/companies/${companyA}`, b.token)).status).toBe(404);
    expect((await client.patch(`/api/companies/${companyA}`, b.token).send({ name: "pwned" })).status).toBe(404);
    expect((await client.get(`/api/campaigns/preview/${companyA}`, b.token)).status).toBe(404);
    expect((await client.get(`/api/campaigns/matches/${companyA}`, b.token)).status).toBe(404);
    expect((await client.post("/api/campaigns", b.token).send({ companyId: companyA, launch: true })).status).toBe(404);
    expect((await client.get(`/api/campaigns/${campaignA}`, b.token)).status).toBe(404);
    expect((await client.post(`/api/sends/campaigns/${campaignA}/dispatch`, b.token)).status).toBe(404);
    expect((await client.post(`/api/campaigns/${campaignA}/status`, b.token).send({ action: "cancel" })).status).toBe(404);
    expect((await client.patch(`/api/sends/${sendA}`, b.token).send({ subject: "x" })).status).toBe(409);
    const bSends = await client.get("/api/sends", b.token);
    expect(bSends.body.total).toBe(0);
    expect((await client.get("/api/admin/users", a.token)).status).toBe(403);
  });
});

describe("matching overview", () => {
  it("counts all matches, unique funds (not duplicate records) and shows only the top 5", async () => {
    await seedInvestors(50, 10);
    // Unenriched / unverified contacts must never count as matches.
    await pool.query(
      `INSERT INTO investors (name, firm, email, is_verified, needs_enrichment) VALUES ('Raw', 'Raw Fund', 'raw@x.test', false, true), ('Raw2', 'Raw Fund', 'raw2@x.test', true, true)`
    );
    const u = await createUser(signToken);
    const company = await createCompany(u.id);

    const preview = await client.get(`/api/campaigns/preview/${company}`, u.token);
    expect(preview.status).toBe(200);
    expect(preview.body.totalMatches).toBe(50);
    expect(preview.body.totalFundsMatched).toBe(10);
    expect(preview.body.investors).toHaveLength(5);
    expect(preview.body.nextCampaignSize).toBe(30); // FREE allowance
    expect(preview.body.entitlement.tier).toBe("FREE");

    const page2 = await client.get(`/api/campaigns/matches/${company}?page=2&pageSize=20`, u.token);
    expect(page2.body).toMatchObject({ total: 50, page: 2, pageSize: 20 });
    expect(page2.body.items).toHaveLength(20);
    const page3 = await client.get(`/api/campaigns/matches/${company}?page=3&pageSize=20`, u.token);
    expect(page3.body.items).toHaveLength(10);
    const search = await client.get(`/api/campaigns/matches/${company}?q=inv%201`, u.token);
    expect(search.body.items.every((i: any) => i.name.includes("inv 1"))).toBe(true);
  });

  it("reflects company edits in matching (changing sector removes sector matches)", async () => {
    await seedInvestors(5);
    const u = await createUser(signToken);
    const company = await createCompany(u.id);
    expect((await client.get(`/api/campaigns/preview/${company}`, u.token)).body.totalMatches).toBe(5);
    const patched = await client.patch(`/api/companies/${company}`, u.token).send({ sector: ["biotech"], stage: "SERIES_B_PLUS", geography: ["Brazil"] });
    expect(patched.status).toBe(200);
    expect((await client.get(`/api/campaigns/preview/${company}`, u.token)).body.totalMatches).toBe(0);
  });
});

describe("campaigns and the free plan", () => {
  it("drafts only the plan allowance, labels the campaign with the real tier, and never re-pitches investors", async () => {
    await seedInvestors(50);
    const u = await createUser(signToken);
    const company = await createCompany(u.id);

    const created = await client.post("/api/campaigns", u.token).send({ companyId: company, launch: true });
    expect(created.status).toBe(201);
    expect(created.body.campaign.tier).toBe("FREE");
    expect(created.body.selectedCount).toBe(30);
    expect(created.body.totalMatches).toBe(50);
    expect(new Set(created.body.drafts.map((d: any) => d.investorId)).size).toBe(30);

    // A forged higher tier is refused, not honoured.
    const forged = await client.post("/api/campaigns", u.token).send({ companyId: company, tier: "GROWTH" });
    expect(forged.status).toBe(402);

    // FREE: one active campaign, and the allowance is already fully drafted.
    const second = await client.post("/api/campaigns", u.token).send({ companyId: company, launch: true });
    expect(second.status).toBe(402);
    expect(second.body.upgradeRequired).toBe(true);

    // Cancelling releases unsent drafts back to the allowance.
    const cancel = await client.post(`/api/campaigns/${created.body.campaign.id}/status`, u.token).send({ action: "cancel" });
    expect(cancel.body.cancelledSends).toBe(30);
    const again = await client.post("/api/campaigns", u.token).send({ companyId: company, launch: true });
    expect(again.status).toBe(201);
    expect(again.body.selectedCount).toBe(30);
  });

  it("excludes already-contacted investors from the next campaign", async () => {
    await seedInvestors(40);
    const u = await createUser(signToken);
    await setSubscription(u.id, "STARTER", { periodEndDays: null });
    await connectGmail(u.id, encrypted, 5);
    const company = await createCompany(u.id);

    const first = await client.post("/api/campaigns", u.token).send({ companyId: company, launch: true });
    expect(first.body.selectedCount).toBe(40);
    expect(first.body.campaign.tier).toBe("STARTER");
    await client.post(`/api/sends/campaigns/${first.body.campaign.id}/dispatch`, u.token);

    const second = await client.post("/api/campaigns", u.token).send({ companyId: company, launch: true });
    expect(second.status).toBe(422);
    expect(second.body.error).toMatch(/already contacted every investor/);
  });

  it("saves nothing when AI generation is unavailable", async () => {
    await seedInvestors(5);
    const { AIProviderUnavailableError } = await import("../../src/lib/llmService");
    generatePersonalizedEmail.mockRejectedValue(new AIProviderUnavailableError("email", ["groq"]));
    const u = await createUser(signToken);
    const company = await createCompany(u.id);
    const res = await client.post("/api/campaigns", u.token).send({ companyId: company, launch: true });
    expect(res.status).toBe(503);
    expect((await pool.query("SELECT COUNT(*)::int AS n FROM campaigns WHERE user_id = $1", [u.id])).rows[0].n).toBe(0);
  });

  it("lets a founder edit a queued draft but strips header-injection characters", async () => {
    await seedInvestors(1);
    const u = await createUser(signToken);
    const company = await createCompany(u.id);
    const created = await client.post("/api/campaigns", u.token).send({ companyId: company, launch: true });
    const sendId = created.body.drafts[0].id;
    const edit = await client.patch(`/api/sends/${sendId}`, u.token).send({ subject: "Hello\r\nBcc: victim@x.test", bodyText: "New body" });
    expect(edit.status).toBe(200);
    expect(edit.body.subject).toBe("Hello Bcc: victim@x.test");
  });
});

describe("dispatch, warm-up and quota", () => {
  it("requires Gmail and sends at most the FREE allowance; then blocks new sends and campaigns", async () => {
    await seedInvestors(50);
    const u = await createUser(signToken);
    const company = await createCompany(u.id);
    const campaign = (await client.post("/api/campaigns", u.token).send({ companyId: company, launch: true })).body.campaign.id;

    const noGmail = await client.post(`/api/sends/campaigns/${campaign}/dispatch`, u.token);
    expect(noGmail.status).toBe(400);
    expect(noGmail.body.gmailRequired).toBe(true);

    await connectGmail(u.id, encrypted, 0);
    const sent = await client.post(`/api/sends/campaigns/${campaign}/dispatch`, u.token);
    expect(sent.status).toBe(200);
    expect(sent.body.dispatched).toBe(30);
    expect(deliverEmail).toHaveBeenCalledTimes(30);

    const quota = await client.get("/api/sends/quota", u.token);
    expect(quota.body).toMatchObject({ entitlementTier: "FREE", investorEmailsTotal: 30, investorEmailsSent: 30, investorEmailsRemaining: 0, quotaExhausted: true });

    const outreach = await client.get("/api/sends?status=SENT&pageSize=10", u.token);
    expect(outreach.body.total).toBe(30);
    expect(outreach.body.items).toHaveLength(10);
    expect(outreach.body.counts).toMatchObject({ SENT: 30, QUEUED: 0 });

    // Campaign completes when nothing is left to send.
    const campaigns = await client.get("/api/campaigns", u.token);
    expect(campaigns.body[0]).toMatchObject({ status: "COMPLETED", counts: { sent: 30, queued: 0 } });

    expect((await client.post("/api/campaigns", u.token).send({ companyId: company, launch: true })).status).toBe(402);
  });

  it("caps day 1-3 at 50/day, then 150/day; replies and bounces still count toward today", async () => {
    await seedInvestors(120);
    const u = await createUser(signToken);
    await setSubscription(u.id, "STARTER", { periodEndDays: null });
    await connectGmail(u.id, encrypted, 0); // warm-up day 1
    const company = await createCompany(u.id);
    const campaign = (await client.post("/api/campaigns", u.token).send({ companyId: company, launch: true })).body.campaign.id;

    const day1 = await client.post(`/api/sends/campaigns/${campaign}/dispatch`, u.token);
    expect(day1.body.dispatched).toBe(50);

    // Investors reply / bounce — these rows were still sent today.
    await pool.query(`UPDATE email_sends SET status = 'REPLIED' WHERE id IN (SELECT id FROM email_sends WHERE user_id = $1 AND status = 'SENT' LIMIT 5)`, [u.id]);
    await pool.query(`UPDATE email_sends SET status = 'BOUNCED', bounced_at = now() WHERE id IN (SELECT id FROM email_sends WHERE user_id = $1 AND status = 'SENT' LIMIT 2)`, [u.id]);
    const capped = await client.post(`/api/sends/campaigns/${campaign}/dispatch`, u.token);
    expect(capped.status).toBe(429);
    expect(deliverEmail).toHaveBeenCalledTimes(50);

    // Day 3 is still warm-up; day 4 (3 full days later) unlocks 150/day.
    await pool.query("UPDATE users SET gmail_connected_at = now() - interval '2 days 23 hours' WHERE id = $1", [u.id]);
    expect((await client.get("/api/sends/quota", u.token)).body).toMatchObject({ warmupDay: 3, currentDailyLimit: 50 });
    await pool.query("UPDATE users SET gmail_connected_at = now() - interval '3 days', send_reputation_score = 1 WHERE id = $1", [u.id]);
    expect((await client.get("/api/sends/quota", u.token)).body).toMatchObject({ warmupComplete: true, currentDailyLimit: 150 });

    const after = await client.post(`/api/sends/campaigns/${campaign}/dispatch`, u.token);
    // Starter allows 100 emails: 50 already sent, so only 50 more — the plan allowance binds before the daily cap.
    expect(after.body.dispatched).toBe(50);
    expect(after.body.remainingQuota).toBe(0);
  });

  it("records failures, retries them, and stops without failing drafts when Gmail access is revoked", async () => {
    await seedInvestors(6);
    const u = await createUser(signToken);
    await connectGmail(u.id, encrypted, 10);
    const company = await createCompany(u.id);
    const campaign = (await client.post("/api/campaigns", u.token).send({ companyId: company, launch: true })).body.campaign.id;

    deliverEmail
      .mockResolvedValueOnce({ delivered: true, via: "gmail_api", messageId: "a", threadId: "a" })
      .mockResolvedValueOnce({ delivered: false, via: "gmail_api", error: "Recipient address rejected" })
      .mockResolvedValueOnce({ delivered: false, via: "gmail_api", error: "revoked", authRevoked: true });
    const first = await client.post(`/api/sends/campaigns/${campaign}/dispatch`, u.token);
    expect(first.body).toMatchObject({ dispatched: 1, failed: 1 });
    expect(first.body.stoppedReason).toBe("revoked");

    const counts = (await client.get("/api/sends", u.token)).body.counts;
    expect(counts).toMatchObject({ SENT: 1, FAILED: 1, QUEUED: 4 });
    // Revoked grant: credentials cleared so the UI asks to reconnect.
    expect((await client.get("/api/profile/me", u.token)).body.gmailConnected).toBe(false);

    await connectGmail(u.id, encrypted, 10);
    const retry = await client.post(`/api/campaigns/${campaign}/retry-failed`, u.token);
    expect(retry.body.requeued).toBe(1);
    const second = await client.post(`/api/sends/campaigns/${campaign}/dispatch`, u.token);
    expect(second.body.dispatched).toBe(5);
    // A SENT email can never be re-sent: dispatching again sends nothing.
    const third = await client.post(`/api/sends/campaigns/${campaign}/dispatch`, u.token);
    expect(third.body.dispatched ?? 0).toBe(0);
    expect(deliverEmail).toHaveBeenCalledTimes(8);
  });

  it("refuses to send from a paused campaign and resumes cleanly", async () => {
    await seedInvestors(3);
    const u = await createUser(signToken);
    await connectGmail(u.id, encrypted, 10);
    const company = await createCompany(u.id);
    const campaign = (await client.post("/api/campaigns", u.token).send({ companyId: company, launch: true })).body.campaign.id;

    expect((await client.post(`/api/campaigns/${campaign}/status`, u.token).send({ action: "pause" })).status).toBe(200);
    expect((await client.post(`/api/campaigns/${campaign}/status`, u.token).send({ action: "pause" })).status).toBe(409);
    expect((await client.post(`/api/sends/campaigns/${campaign}/dispatch`, u.token)).status).toBe(409);
    expect((await client.post(`/api/campaigns/${campaign}/status`, u.token).send({ action: "resume" })).status).toBe(200);
    expect((await client.post(`/api/sends/campaigns/${campaign}/dispatch`, u.token)).body.dispatched).toBe(3);
  });

  it("an expired paid plan falls back to the FREE allowance for already-queued work", async () => {
    await seedInvestors(60);
    const u = await createUser(signToken);
    await setSubscription(u.id, "GROWTH", { periodEndDays: 30, periodStartDaysAgo: 1 });
    await connectGmail(u.id, encrypted, 10);
    const company = await createCompany(u.id);
    const campaign = (await client.post("/api/campaigns", u.token).send({ companyId: company, launch: true })).body.campaign.id;
    expect((await pool.query("SELECT COUNT(*)::int AS n FROM email_sends WHERE campaign_id = $1", [campaign])).rows[0].n).toBe(60);

    await pool.query("UPDATE subscriptions SET current_period_end = now() - interval '1 minute' WHERE user_id = $1", [u.id]);
    const res = await client.post(`/api/sends/campaigns/${campaign}/dispatch`, u.token);
    expect(res.body.dispatched).toBe(30); // FREE lifetime allowance, not the lapsed Growth one
  });
});

describe("Gmail OAuth state handling", () => {
  it("only attaches Gmail to the account that confirms, and the confirmation is single-use", async () => {
    const { createOAuthState } = await import("../../src/routes/googleAuth");
    const attacker = await createUser(signToken);
    const victim = await createUser(signToken);
    const payload = { encryptedRefreshToken: encrypted, gmailAddress: "victim@gmail.test", grantedScopes: "https://www.googleapis.com/auth/gmail.send" };

    const nonce = await createOAuthState("gmail_confirm", attacker.id, 60_000, payload);
    const mismatch = await client.post("/api/profile/gmail/confirm", victim.token).send({ nonce });
    expect(mismatch.status).toBe(403);
    expect((await pool.query("SELECT google_refresh_token FROM users WHERE id IN ($1, $2) AND google_refresh_token IS NOT NULL", [attacker.id, victim.id])).rows).toHaveLength(0);

    const own = await createOAuthState("gmail_confirm", victim.id, 60_000, payload);
    expect((await client.post("/api/profile/gmail/confirm", victim.token).send({ nonce: own })).status).toBe(200);
    expect((await client.post("/api/profile/gmail/confirm", victim.token).send({ nonce: own })).status).toBe(410);
    const profile = await client.get("/api/profile/me", victim.token);
    expect(profile.body).toMatchObject({ gmailConnected: true, connectedGmailAddress: "victim@gmail.test" });
  });

  it("never lets the Gmail callback consume a Sign-In state (separate purposes)", async () => {
    const { createOAuthState } = await import("../../src/routes/googleAuth");
    const signinState = await createOAuthState("signin", null, 60_000);
    const res = await client.get(`/auth/google/callback?code=abc&state=${encodeURIComponent(signinState)}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("gmail_error=invalid_state");
    // The sign-in state is still usable by its own flow (it wasn't consumed).
    expect((await pool.query("SELECT 1 FROM oauth_states WHERE state = $1", [signinState])).rows).toHaveLength(1);
  });

  it("exchanges a one-time sign-in code for a session exactly once", async () => {
    const { createOAuthState } = await import("../../src/routes/googleAuth");
    const u = await createUser(signToken);
    const code = await createOAuthState("signin_code", u.id, 60_000);
    const first = await client.post("/api/auth/google/exchange").send({ code });
    expect(first.status).toBe(200);
    expect(first.body.user.id).toBe(u.id);
    expect((await client.post("/api/auth/google/exchange").send({ code })).status).toBe(401);
  });

  it("rejects a sign-in callback whose state isn't bound to the browser cookie", async () => {
    const { createOAuthState } = await import("../../src/routes/googleAuth");
    const state = await createOAuthState("signin", null, 60_000);
    const res = await client.get(`/auth/google/signin/callback?code=abc&state=${encodeURIComponent(state)}`);
    expect(res.headers.location).toContain("google_error=invalid_state");
  });
});

describe("enterprise enquiries", () => {
  it("validates, stores once, and reaches the admin sales queue", async () => {
    const admin = await createUser(signToken, { role: "ADMIN" });
    const missing = await client.post("/api/leads").send({ name: "A", company: "B", email: "a@b.co", message: "hi", outreachVolume: "500-2000" });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toMatch(/phone/i);

    const lead = { name: "Priya", company: "Acme", email: "priya@acme.co", phone: "+91 98765 43210", outreachVolume: "500-2000", message: "Need 3 raises", source: "pricing" };
    expect((await client.post("/api/leads").send(lead)).status).toBe(201);
    const dup = await client.post("/api/leads").send(lead);
    expect(dup.body.duplicate).toBe(true);

    const leads = await client.get("/api/admin/leads", admin.token);
    expect(leads.body.filter((l: any) => l.email === "priya@acme.co")).toHaveLength(1);
    const notes = await client.get("/api/notifications", admin.token);
    expect(notes.body.some((n: any) => n.type === "enterprise_lead")).toBe(true);
    const updated = await client.patch(`/api/admin/leads/${leads.body[0].id}`, admin.token).send({ status: "CONTACTED" });
    expect(updated.body.status).toBe("CONTACTED");
  });
});

describe("rate limiting", () => {
  it("never rate-limits the session check that every dashboard page makes", async () => {
    const u = await createUser(signToken);
    const request = (await import("supertest")).default;
    // Same client IP for all calls, well past the 20-per-15-minutes credential limit.
    for (let i = 0; i < 30; i++) {
      const res = await request(app).get("/api/auth/me").set("X-Forwarded-For", "10.99.0.1").set("Authorization", `Bearer ${u.token}`);
      expect(res.status).toBe(200);
    }
  });

  it("still rate-limits repeated login attempts from one IP", async () => {
    const request = (await import("supertest")).default;
    let last = 0;
    for (let i = 0; i < 22; i++) {
      last = (await request(app).post("/api/auth/login").set("X-Forwarded-For", "10.99.0.2").send({ email: "x@example.com", password: "wrong" })).status;
    }
    expect(last).toBe(429);
  });
});

describe("CORS", () => {
  it("allows every method the frontend uses from the configured origin (incl. PUT for profile autosave)", async () => {
    const request = (await import("supertest")).default;
    const res = await request(app).options("/api/company-profile/x/sections/overview").set("Origin", "http://localhost:3000").set("Access-Control-Request-Method", "PUT");
    expect(res.status).toBe(204);
    for (const m of ["GET", "POST", "PUT", "PATCH", "DELETE"]) expect(res.headers["access-control-allow-methods"]).toContain(m);
    const foreign = await request(app).options("/api/companies").set("Origin", "https://evil.example").set("Access-Control-Request-Method", "GET");
    expect(foreign.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
