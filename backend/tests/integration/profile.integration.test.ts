/**
 * Onboarding v2, company intelligence, matching v2 discovery, draft campaigns and the
 * Overview command centre — against real SQL (PGlite). AI is mocked.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import type { Express } from "express";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const { aiState, deliverEmail } = vi.hoisted(() => ({
  aiState: { available: true, response: "" as string, lastInput: "" as string },
  deliverEmail: vi.fn(),
}));

vi.mock("../../src/lib/db", async () => await import("./testDb"));
vi.mock("../../src/lib/emailDelivery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/emailDelivery")>()),
  deliverEmail,
}));
vi.mock("../../src/lib/llmService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/llmService")>();
  return {
    ...actual,
    isAIFeatureAvailable: () => aiState.available,
    generatePersonalizedEmail: async (i: any) => ({ subject: `Intro: ${i.companyName}`, body: `Hi ${i.investorName}`, provider: "mock" }),
    completeStructured: async (_f: string, _s: string, input: string, parse: (t: string) => any) => {
      aiState.lastInput = input;
      if (!aiState.available) throw new actual.AIProviderUnavailableError("profile", []);
      return { value: parse(aiState.response), provider: "mock" };
    },
  };
});

import { applyTestEnv, api, createUser, seedInvestors } from "./helpers";
import { pool, getTestDb } from "./testDb";

let client: ReturnType<typeof api>;
let signToken: (p: any) => string;

beforeAll(async () => {
  applyTestEnv();
  await getTestDb();
  const app: Express = (await import("../../src/app")).app;
  signToken = (await import("../../src/lib/auth")).signToken;
  client = api(app);
}, 120_000);

beforeEach(async () => {
  aiState.available = true;
  aiState.response = JSON.stringify({
    fields: {
      positioning: { value: "Instant payouts for freelancers", basis: "FOUNDER_PROVIDED" },
      industry: { value: "Fintech", basis: "AI_CLASSIFICATION" },
      founderMarketFit: { value: "Founder ran payments at a bank", basis: "INFERRED" },
      tractionSummary: { value: "Processes $9,999,999 per month", basis: "FOUNDER_PROVIDED" },
    },
    thesisCategories: [{ value: "cross-border", basis: "AI_CLASSIFICATION" }],
    missingInformation: ["Competitors"],
    inconsistencies: [],
  });
  deliverEmail.mockReset();
  deliverEmail.mockResolvedValue({ delivered: true, via: "gmail_api", messageId: "m", threadId: "t" });
  await pool.query("DELETE FROM email_sends");
  await pool.query("DELETE FROM campaigns");
  await pool.query("DELETE FROM investors");
});

/** Runs the 7 steps via the API the way the onboarding UI does. */
async function onboard(token: string, opts: { complete?: boolean } = {}) {
  const created = await client.post("/api/company-profile", token).send({ name: "Velo Pay" });
  const id = created.body.id as string;
  const me = created.body.founders[0];
  await client.put(`/api/company-profile/${id}/founders/${me.id}`, token).send({
    fullName: "Asha Rao",
    role: "CEO",
    linkedinUrl: "https://www.linkedin.com/in/asha",
    experience: "8 years in payments at a bank",
    domainExpertise: ["payments"],
    skills: ["TECHNICAL", "PRODUCT"],
    previousFounder: true,
    commitment: "FULL_TIME",
  });
  await client.put(`/api/company-profile/${id}/sections/overview`, token).send({
    name: "Velo Pay",
    headquarters: "India",
    sector: ["fintech", "payments"],
    businessType: ["B2B", "SAAS"],
    oneLiner: "Instant payouts for freelancers",
    problem: "Freelancers wait weeks to get paid.",
    solution: "Same-day cross-border payouts.",
  });
  await client.put(`/api/company-profile/${id}/sections/productMarket`, token).send({ productStage: "LAUNCHED", targetGeographies: ["India"] });
  await client.put(`/api/company-profile/${id}/sections/traction`, token).send({ mrrUsd: 12000, arrUsd: 144000, payingCustomers: 40 });
  await client.put(`/api/company-profile/${id}/sections/fundraising`, token).send({ stage: "SEED", targetAmountUsd: 500000, useOfFunds: [{ category: "Engineering", percent: 60 }, { category: "Sales", percent: 40 }] });
  if (opts.complete) {
    await client.post(`/api/company-profile/${id}/intelligence/generate`, token);
    await client.post(`/api/company-profile/${id}/intelligence/confirm`, token);
    const done = await client.post(`/api/company-profile/${id}/onboarding/complete`, token);
    expect(done.status).toBe(200);
  }
  return id;
}

describe("onboarding v2", () => {
  it("a new founder is not onboarded until the profile is complete and the summary confirmed", async () => {
    const u = await createUser(signToken);
    expect((await client.get("/api/auth/me", u.token)).body.hasCompany).toBe(false);
    const id = await onboard(u.token);

    // Draft exists but onboarding isn't complete — /me must still say "go to onboarding".
    expect((await client.get("/api/auth/me", u.token)).body.hasCompany).toBe(false);
    const early = await client.post(`/api/company-profile/${id}/onboarding/complete`, u.token);
    expect(early.status).toBe(400);
    expect(early.body.error).toMatch(/confirm your company profile summary/);

    await client.post(`/api/company-profile/${id}/intelligence/generate`, u.token);
    await client.post(`/api/company-profile/${id}/intelligence/confirm`, u.token);
    expect((await client.post(`/api/company-profile/${id}/onboarding/complete`, u.token)).status).toBe(200);
    expect((await client.get("/api/auth/me", u.token)).body.hasCompany).toBe(true);
  });

  it("refuses to complete with required fields missing and says which", async () => {
    const u = await createUser(signToken);
    const id = (await client.post("/api/company-profile", u.token).send({ name: "Half Done" })).body.id;
    await client.post(`/api/company-profile/${id}/intelligence/generate`, u.token);
    await client.post(`/api/company-profile/${id}/intelligence/confirm`, u.token);
    const res = await client.post(`/api/company-profile/${id}/onboarding/complete`, u.token);
    expect(res.status).toBe(400);
    expect(res.body.details.missing.map((m: any) => m.label)).toContain("Funding stage");
  });

  it("autosaves and resumes: step and data survive a new session; re-starting reuses the draft", async () => {
    const u = await createUser(signToken);
    const id = await onboard(u.token);
    await client.post(`/api/company-profile/${id}/onboarding/step`, u.token).send({ step: 4 });
    const fresh = signToken({ userId: u.id, role: "FOUNDER" }); // e.g. after logout / Google sign-in
    const resumed = await client.get("/api/company-profile", fresh);
    expect(resumed.body).toMatchObject({ id, onboarding: { step: 4, completedAt: null } });
    expect(resumed.body.overview.problem).toBe("Freelancers wait weeks to get paid.");
    const again = await client.post("/api/company-profile", fresh).send({ name: "Velo Pay" });
    expect(again.body.id).toBe(id);
    expect((await pool.query("SELECT COUNT(*)::int AS n FROM companies WHERE user_id = $1", [u.id])).rows[0].n).toBe(1);
  });

  it("supports multiple co-founders on one company without duplicating it", async () => {
    const u = await createUser(signToken);
    const id = await onboard(u.token);
    const add = await client.post(`/api/company-profile/${id}/founders`, u.token).send({ fullName: "Ravi Iyer", role: "CTO", skills: ["TECHNICAL"], commitment: "FULL_TIME" });
    expect(add.status).toBe(201);
    const profile = await client.get(`/api/company-profile?companyId=${id}`, u.token);
    expect(profile.body.founders.map((f: any) => f.fullName)).toEqual(["Asha Rao", "Ravi Iyer"]);
    expect((await client.delete(`/api/company-profile/${id}/founders/${profile.body.founders[0].id}`, u.token)).status).toBe(400); // own profile can't be removed
    expect((await client.delete(`/api/company-profile/${id}/founders/${add.body.id}`, u.token)).status).toBe(200);
  });

  it("accepts a founder record round-tripped from the API (empty optional fields are null)", async () => {
    const u = await createUser(signToken);
    const p = (await client.post("/api/company-profile", u.token).send({ name: "Round Trip" })).body;
    const { id, isAccountHolder, position, ...founder } = p.founders[0];
    expect(founder.linkedinUrl).toBeNull();
    const res = await client.put(`/api/company-profile/${p.id}/founders/${id}`, u.token).send({ ...founder, role: "CEO" });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("CEO");
  });

  it("validates every field server-side", async () => {
    const u = await createUser(signToken);
    const id = (await client.post("/api/company-profile", u.token).send({ name: "X" })).body.id;
    const bad = async (section: string, body: object) => (await client.put(`/api/company-profile/${id}/sections/${section}`, u.token).send(body)).body.error;
    expect(await bad("overview", { website: "not a url" })).toMatch(/full URL/);
    expect(await bad("overview", { businessType: ["SPACESHIP"] })).toBeTruthy();
    expect(await bad("fundraising", { targetAmountUsd: 100, committedAmountUsd: 200 })).toMatch(/can't exceed/);
    expect(await bad("fundraising", { useOfFunds: [{ category: "A", percent: 50 }] })).toMatch(/add up to 100/);
    expect(await bad("preferences", { minCheckUsd: 500, maxCheckUsd: 100 })).toMatch(/can't be larger/);
    expect(await bad("traction", { madeUpMetric: 5 })).toMatch(/Unknown traction metric/);
    expect(await bad("traction", { mrrUsd: "lots" })).toMatch(/wrong type/);
    const founder = await client.post(`/api/company-profile/${id}/founders`, u.token).send({ fullName: "Y", linkedinUrl: "https://example.com/me" });
    expect(founder.body.error).toMatch(/LinkedIn/);
  });

  it("never lets a founder read or edit another founder's company or founders", async () => {
    const a = await createUser(signToken);
    const b = await createUser(signToken);
    const id = await onboard(a.token);
    const founderId = (await client.get(`/api/company-profile?companyId=${id}`, a.token)).body.founders[0].id;
    expect((await client.get(`/api/company-profile?companyId=${id}`, b.token)).status).toBe(404);
    expect((await client.put(`/api/company-profile/${id}/sections/overview`, b.token).send({ name: "pwned" })).status).toBe(404);
    expect((await client.put(`/api/company-profile/${id}/founders/${founderId}`, b.token).send({ fullName: "pwned" })).status).toBe(404);
    expect((await client.post(`/api/company-profile/${id}/founders`, b.token).send({ fullName: "intruder" })).status).toBe(404);
    expect((await client.post(`/api/company-profile/${id}/intelligence/generate`, b.token)).status).toBe(404);
    expect((await client.get(`/api/discovery/matches?companyId=${id}`, b.token)).status).toBe(404);
  });
});

describe("conditional questions", () => {
  it("asks SaaS metrics for SaaS, marketplace metrics for marketplaces, and no revenue metrics at idea stage", async () => {
    const u = await createUser(signToken);
    const q = async (qs: string) => (await client.get(`/api/company-profile/questions?${qs}`, u.token)).body.traction.map((x: any) => x.key);
    const saas = await q("businessTypes=SAAS&productStage=LAUNCHED");
    expect(saas).toEqual(expect.arrayContaining(["mrrUsd", "arrUsd", "monthlyChurnPct", "monthlyRevenueUsd"]));
    expect(saas).not.toContain("gmvMonthlyUsd");
    const market = await q("businessTypes=MARKETPLACE&productStage=MVP");
    expect(market).toEqual(expect.arrayContaining(["gmvMonthlyUsd", "takeRatePct"]));
    expect(market).not.toContain("mrrUsd");
    const idea = await q("businessTypes=B2C&productStage=IDEA");
    expect(idea).toEqual(expect.arrayContaining(["customerDiscovery", "waitlist"]));
    expect(idea).not.toContain("monthlyRevenueUsd");
    const fintechAi = await q("businessTypes=B2B&industries=fintech,AI&productStage=MVP");
    expect(fintechAi).toEqual(expect.arrayContaining(["regulatoryStatus", "proprietaryData"]));
  });
});

describe("company intelligence", () => {
  it("separates provenance, flags figures not in the founder's answers, and keeps financials out of AI without consent", async () => {
    const u = await createUser(signToken);
    const id = await onboard(u.token);
    const intel = await client.post(`/api/company-profile/${id}/intelligence/generate`, u.token);
    expect(intel.status).toBe(200);
    const f = intel.body.profile.fields;
    expect(f.industry.basis).toBe("AI_CLASSIFICATION");
    expect(f.founderMarketFit.basis).toBe("INFERRED");
    // $9,999,999 never appeared in the input → downgraded and warned.
    expect(f.tractionSummary).toMatchObject({ basis: "INFERRED", warning: expect.stringMatching(/isn't in your answers/) });
    expect(intel.body.profile.inconsistencies).toEqual([]);
    expect(intel.body.profile.missingInformation).toEqual(expect.arrayContaining(["Competitors"]));
    // Sensitive metrics were withheld from the AI request.
    expect(aiState.lastInput).toContain("(provided, withheld from AI)");
    expect(aiState.lastInput).not.toContain("12000");

    await client.put(`/api/company-profile/${id}/ai-consent`, u.token).send({ consent: true });
    await client.post(`/api/company-profile/${id}/intelligence/generate`, u.token);
    expect(aiState.lastInput).toContain("12000");
  });

  it("detects inconsistencies deterministically (ARR vs MRR)", async () => {
    const u = await createUser(signToken);
    const id = await onboard(u.token);
    await client.put(`/api/company-profile/${id}/sections/traction`, u.token).send({ mrrUsd: 10000, arrUsd: 500000 });
    const intel = await client.post(`/api/company-profile/${id}/intelligence/generate`, u.token);
    expect(intel.body.profile.inconsistencies.join(" ")).toMatch(/12 × MRR/);
  });

  it("works without AI using only founder-provided facts", async () => {
    aiState.available = false;
    const u = await createUser(signToken);
    const id = await onboard(u.token);
    const intel = await client.post(`/api/company-profile/${id}/intelligence/generate`, u.token);
    expect(intel.body.profile.aiUsed).toBe(false);
    expect(Object.values(intel.body.profile.fields).every((x: any) => x.basis === "FOUNDER_PROVIDED")).toBe(true);
    expect(intel.body.profile.fields.positioning.value).toBe("Instant payouts for freelancers");
  });

  it("lets the founder correct fields; corrections are marked founder-confirmed and editing re-opens review", async () => {
    const u = await createUser(signToken);
    const id = await onboard(u.token);
    await client.post(`/api/company-profile/${id}/intelligence/generate`, u.token);
    await client.post(`/api/company-profile/${id}/intelligence/confirm`, u.token);
    const edited = await client.patch(`/api/company-profile/${id}/intelligence`, u.token).send({ fields: { tractionSummary: "40 paying customers" }, thesisCategories: ["payments infra"] });
    expect(edited.body.status).toBe("DRAFT");
    expect(edited.body.profile.fields.tractionSummary).toEqual({ value: "40 paying customers", basis: "FOUNDER_CONFIRMED" });
    expect(edited.body.generated.fields.tractionSummary.value).toMatch(/9,999,999/); // original kept separately
    expect((await client.patch(`/api/company-profile/${id}/intelligence`, u.token).send({ fields: { madeUp: "x" } })).status).toBe(400);
  });
});

describe("matching v2 via discovery", () => {
  it("returns people and funds with evidence, saves/excludes, and excluded investors drop out", async () => {
    await seedInvestors(12, 4);
    const u = await createUser(signToken);
    const id = await onboard(u.token, { complete: true });
    const people = await client.get(`/api/discovery/matches?companyId=${id}&pageSize=5`, u.token);
    expect(people.body).toMatchObject({ view: "people", total: 12, totalMatches: 12, totalFunds: 4 });
    const top = people.body.items[0];
    expect(top.reasons.join(" ")).toMatch(/Invests in fintech/);
    expect(top.components.sector.evidence).toBeTruthy();
    expect(top.missing.length).toBeGreaterThan(0); // unenriched investor fields reported, not guessed

    const funds = await client.get(`/api/discovery/matches?companyId=${id}&view=funds`, u.token);
    expect(funds.body.total).toBe(4);
    expect(funds.body.items[0].recommendedContact.name).toBeTruthy();
    const fund = await client.get(`/api/discovery/funds/${encodeURIComponent(funds.body.items[0].fundKey)}?companyId=${id}`, u.token);
    expect(fund.body.people.length).toBe(3);

    await client.put("/api/discovery/lists", u.token).send({ companyId: id, investorId: top.id, list: "EXCLUDED" });
    const after = await client.get(`/api/discovery/matches?companyId=${id}`, u.token);
    expect(after.body.totalMatches).toBe(11);
    const person = await client.get(`/api/discovery/people/${top.id}?companyId=${id}`, u.token);
    expect(person.body.match).toBeNull();
    expect(person.body.notMatchedReason).toMatch(/excluded/);
    await client.put("/api/discovery/lists", u.token).send({ companyId: id, investorId: people.body.items[1].id, list: "SAVED" });
    expect((await client.get(`/api/discovery/matches?companyId=${id}&list=saved`, u.token)).body.total).toBe(1);
  });

  it("returns an honest empty result when nothing fits", async () => {
    await pool.query(`INSERT INTO investors (name, firm, email, stage_focus, sector_focus, geo_focus, is_verified, needs_enrichment) VALUES ('Bio', 'Bio Fund', 'b@x.test', '{SERIES_B_PLUS}', '{biotech}', '{Germany}', true, false)`);
    const u = await createUser(signToken);
    const id = await onboard(u.token, { complete: true });
    const res = await client.get(`/api/discovery/matches?companyId=${id}`, u.token);
    expect(res.body).toMatchObject({ total: 0, totalMatches: 0, items: [] });
  });

  it("asks for profile data instead of matching an incomplete profile", async () => {
    const u = await createUser(signToken);
    const id = (await client.post("/api/company-profile", u.token).send({ name: "Bare" })).body.id;
    const res = await client.get(`/api/discovery/matches?companyId=${id}`, u.token);
    expect(res.status).toBe(409);
    expect(res.body.incomplete).toBe(true);
  });
});

describe("draft campaigns from selected investors", () => {
  it("drafts only for selected eligible investors, then launches; drafts can be added and removed", async () => {
    await seedInvestors(10, 5);
    const u = await createUser(signToken);
    const id = await onboard(u.token, { complete: true });
    const ids = (await client.get(`/api/discovery/matches?companyId=${id}&pageSize=10`, u.token)).body.items.map((x: any) => x.id);
    const res = await client.post("/api/campaigns", u.token).send({ companyId: id, investorIds: [ids[0], ids[1], "not-an-investor"] });
    expect(res.status).toBe(201);
    expect(res.body.campaign.status).toBe("DRAFT");
    expect(res.body.selectedCount).toBe(2);
    expect(res.body.rejectedInvestorIds).toEqual(["not-an-investor"]);
    const campaignId = res.body.campaign.id;

    // A draft can't send.
    await pool.query("UPDATE users SET google_refresh_token = 'x', gmail_connected_at = now() WHERE id = $1", [u.id]);
    expect((await client.post(`/api/sends/campaigns/${campaignId}/dispatch`, u.token)).status).toBe(409);

    const added = await client.post(`/api/campaigns/${campaignId}/drafts`, u.token).send({ investorIds: [ids[2], ids[0]] });
    expect(added.body.added).toBe(1); // ids[0] already drafted
    const detail = await client.get(`/api/campaigns/${campaignId}`, u.token);
    expect(detail.body.sends).toHaveLength(3);
    expect((await client.delete(`/api/campaigns/${campaignId}/drafts/${detail.body.sends[0].id}`, u.token)).status).toBe(200);

    expect((await client.post(`/api/campaigns/${campaignId}/launch`, u.token)).body.campaign.status).toBe("ACTIVE");
    expect((await client.post(`/api/campaigns/${campaignId}/launch`, u.token)).status).toBe(409);
    expect((await client.post(`/api/sends/campaigns/${campaignId}/dispatch`, u.token)).body.dispatched).toBe(2);
    const timeline = (await client.get(`/api/campaigns/${campaignId}`, u.token)).body.timeline.map((t: any) => t.kind);
    expect(timeline).toEqual(expect.arrayContaining(["created", "launched", "sent"]));
  });

  it("fills a founder's template instead of AI when one is chosen", async () => {
    await seedInvestors(2, 2);
    const u = await createUser(signToken);
    const id = await onboard(u.token, { complete: true });
    const t = await client.post("/api/email-templates", u.token).send({ name: "Short", subject: "{{companyName}} x {{firm}}", body: "Hi {{investorName}}, {{matchReason}}. {{unknownField}}" });
    const res = await client.post("/api/campaigns", u.token).send({ companyId: id, templateId: t.body.id });
    expect(res.body.drafts[0].subject).toMatch(/^Velo Pay x .*Fund/);
    expect(res.body.drafts[0].bodyText).toContain("{{unknownField}}");
    expect(res.body.drafts[0].provider).toBe("template");
  });
});

describe("overview command centre", () => {
  it("recommends the next action along the journey", async () => {
    await seedInvestors(5, 5);
    const u = await createUser(signToken);
    expect((await client.get("/api/overview", u.token)).body.nextAction.key).toBe("continue_profile");
    const id = await onboard(u.token, { complete: true });
    let o = (await client.get("/api/overview", u.token)).body;
    expect(o.nextAction.key).toBe("review_investors");
    expect(o.matches).toMatchObject({ total: 5, funds: 5, nextCampaignSize: 5 });
    const c = await client.post("/api/campaigns", u.token).send({ companyId: id });
    o = (await client.get("/api/overview", u.token)).body;
    expect(o.nextAction).toMatchObject({ key: "review_draft", href: `/dashboard/outreach/campaigns/${c.body.campaign.id}` });
    await client.post(`/api/campaigns/${c.body.campaign.id}/launch`, u.token);
    expect((await client.get("/api/overview", u.token)).body.nextAction.key).toBe("connect_gmail");
    expect(o.journey.find((s: any) => s.key === "profile").state).toBe("done");
  });
});

describe("backward compatibility", () => {
  it("existing companies (created before v2) count as onboarded and keep matching", async () => {
    const u = await createUser(signToken);
    // Old-style insert, as the v1 onboarding did, then the v2 backfill semantics.
    const row = (
      await pool.query(
        `INSERT INTO companies (user_id, name, one_liner, problem, solution, stage, sector, geography, ask_amount_usd, onboarding_completed_at)
         VALUES ($1, 'Legacy Co', 'x', 'p', 's', 'SEED', '{fintech}', '{India}', 500000, now()) RETURNING id`,
        [u.id]
      )
    ).rows[0];
    await seedInvestors(3, 3);
    expect((await client.get("/api/auth/me", u.token)).body.hasCompany).toBe(true);
    const p = (await client.get(`/api/company-profile?companyId=${row.id}`, u.token)).body;
    expect(p.fundraising).toMatchObject({ stage: "SEED", targetAmountUsd: 500000 });
    expect(p.productMarket.targetGeographies).toEqual(["India"]);
    expect((await client.get(`/api/discovery/matches?companyId=${row.id}`, u.token)).body.totalMatches).toBe(3);
  });

  it("keeps a v1 company's free-text traction note when structured metrics are saved", async () => {
    const u = await createUser(signToken);
    const row = (
      await pool.query(
        `INSERT INTO companies (user_id, name, one_liner, problem, solution, stage, sector, geography, ask_amount_usd, traction, onboarding_completed_at)
         VALUES ($1, 'Legacy', 'x', 'p', 's', 'SEED', '{fintech}', '{India}', 500000, '200 pilot users, 3 LOIs', now()) RETURNING id`,
        [u.id]
      )
    ).rows[0];
    expect((await client.get(`/api/company-profile?companyId=${row.id}`, u.token)).body.traction.summary).toBe("200 pilot users, 3 LOIs");
    const saved = await client.put(`/api/company-profile/${row.id}/sections/traction`, u.token).send({ summary: "200 pilot users, 3 LOIs", waitlist: 900 });
    expect(saved.body.traction).toEqual({ summary: "200 pilot users, 3 LOIs", waitlist: 900 });
    const raw = (await pool.query("SELECT traction, traction_metrics FROM companies WHERE id = $1", [row.id])).rows[0];
    expect(raw.traction).toBe("200 pilot users, 3 LOIs");
    expect(raw.traction_metrics).toEqual({ waitlist: 900 });
  });

  it("the v2 migration backfills pre-existing companies as complete exactly once", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const fs = await import("fs");
    const path = await import("path");
    const db = new PGlite();
    const dir = path.join(__dirname, "..", "..", "sql");
    await db.exec(fs.readFileSync(path.join(dir, "schema.sql"), "utf-8").replace(/CREATE EXTENSION[^;]*;/gi, ""));
    const files = fs.readdirSync(path.join(dir, "migrations")).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files.filter((x) => !x.includes("company_profile_v2"))) await db.exec(fs.readFileSync(path.join(dir, "migrations", f), "utf-8"));
    await db.exec(`INSERT INTO users (id, email) VALUES ('u1', 'a@b.c');
      INSERT INTO companies (user_id, name, one_liner, problem, solution, stage, ask_amount_usd) VALUES ('u1', 'Old', 'x', 'p', 's', 'SEED', 1000);`);
    const v2 = fs.readFileSync(path.join(dir, "migrations", files.find((x) => x.includes("company_profile_v2"))!), "utf-8");
    await db.exec(v2);
    expect((await db.query<any>("SELECT onboarding_completed_at FROM companies")).rows[0].onboarding_completed_at).not.toBeNull();
    // A v2 draft with old-style fields filled must NOT be marked complete on a re-run.
    await db.exec(`INSERT INTO companies (user_id, name, one_liner, problem, solution, stage, ask_amount_usd) VALUES ('u1', 'Draft', 'x', 'p', 's', 'SEED', 1000);`);
    await db.exec(v2);
    expect((await db.query<any>("SELECT onboarding_completed_at FROM companies WHERE name = 'Draft'")).rows[0].onboarding_completed_at).toBeNull();
    await db.close();
  });
});

describe("matching weights admin", () => {
  it("validates and persists configurable weights", async () => {
    const admin = await createUser(signToken, { role: "ADMIN" });
    const founder = await createUser(signToken);
    expect((await client.get("/api/admin/matching-weights", founder.token)).status).toBe(403);
    const bad = await client.put("/api/admin/matching-weights", admin.token).send({ weights: { sector: 50 } });
    expect(bad.status).toBe(400);
    const w = { sector: 25, stage: 15, checkSize: 15, thesis: 15, businessModel: 10, geography: 10, founderMarketFit: 5, tractionMandate: 5 };
    expect((await client.put("/api/admin/matching-weights", admin.token).send({ weights: w })).body.weights).toEqual(w);
    expect((await client.get("/api/admin/matching-weights", admin.token)).body.weights).toEqual(w);
    await pool.query("DELETE FROM matching_config");
  });
});
