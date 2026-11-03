import { Router } from "express";
import { z } from "zod";
import { pool, Queryable, withUserLock } from "../lib/db";
import { requireAuth } from "../lib/auth";
import { fundKey, MatchResult } from "../services/matchingService";
import { AIProviderUnavailableError, generatePersonalizedEmail, isAIFeatureAvailable } from "../lib/llmService";
import { authorizeCampaignTier, PRICING_TIERS } from "../services/pricingService";
import { loadEntitlement } from "../services/entitlementService";
import { rankForCompany, RankedCompany, toMatchResponse } from "../services/matchingContext";
import { createNotification } from "./notifications";
import { markCampaignCompletedIfDone } from "./sends";
import { sanitizeHeaderValue } from "../lib/emailDelivery";

export const campaignRouter = Router();
campaignRouter.use(requireAuth);

const INCOMPLETE_PROFILE = "Add your funding stage and industry to your company profile before matching investors.";

/** Overview: totals over ALL matches + the top 5. */
campaignRouter.get("/preview/:companyId", async (req, res) => {
  const userId = req.auth!.userId;
  const r = await rankForCompany(userId, req.params.companyId);
  if (!r) return res.status(404).json({ error: "Company not found." });
  if (r === "incomplete") return res.status(400).json({ error: INCOMPLETE_PROFILE, incomplete: true });

  const entitlement = await loadEntitlement(userId);
  const fresh = r.ranked.filter((m) => !r.alreadyContacted.has(m.investorId));
  res.json({
    mode: "verified",
    totalMatches: r.ranked.length,
    totalFundsMatched: new Set(r.ranked.map((m) => fundKey(r.investors.get(m.investorId)?.firm))).size,
    alreadyContactedCount: r.ranked.length - fresh.length,
    nextCampaignSize: Math.min(fresh.length, entitlement.quota.remainingToAllocate),
    matchableInvestorCount: r.matchableCount,
    entitlement: { tier: entitlement.tier, investorLimit: entitlement.quota.limit, remainingToAllocate: entitlement.quota.remainingToAllocate },
    investors: r.ranked.slice(0, 5).map((m) => toMatchResponse(r, m)),
  });
});

const matchesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  minScore: z.coerce.number().min(0).max(100).default(0),
  q: z.string().trim().max(100).optional(),
  hideContacted: z.enum(["true", "false"]).default("false"),
});

/** Full ranked list (kept for existing clients; Investor Discovery uses /api/discovery). */
campaignRouter.get("/matches/:companyId", async (req, res) => {
  const parsed = matchesQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid query." });
  const { page, pageSize, minScore, q, hideContacted } = parsed.data;
  const r = await rankForCompany(req.auth!.userId, req.params.companyId);
  if (!r) return res.status(404).json({ error: "Company not found." });
  if (r === "incomplete") return res.status(400).json({ error: INCOMPLETE_PROFILE, incomplete: true });

  const needle = q?.toLowerCase();
  const filtered = r.ranked.filter((m) => {
    const inv = r.investors.get(m.investorId)!;
    if (m.score < minScore) return false;
    if (hideContacted === "true" && r.alreadyContacted.has(m.investorId)) return false;
    return !needle || inv.name.toLowerCase().includes(needle) || inv.firm.toLowerCase().includes(needle);
  });
  res.json({
    total: filtered.length,
    totalMatches: r.ranked.length,
    totalFundsMatched: new Set(r.ranked.map((m) => fundKey(r.investors.get(m.investorId)?.firm))).size,
    page,
    pageSize,
    items: filtered.slice((page - 1) * pageSize, page * pageSize).map((m) => toMatchResponse(r, m)),
  });
});

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Merge fields available in templates. Unknown {{fields}} are left visible so the founder notices. */
export function renderTemplate(template: { subject: string; body: string }, vars: Record<string, string>) {
  const fill = (s: string) => s.replace(/\{\{\s*(\w+)\s*\}\}/g, (all, key: string) => (key in vars ? vars[key]! : all));
  return { subject: sanitizeHeaderValue(fill(template.subject)).slice(0, 200), body: fill(template.body).slice(0, 10000) };
}

interface DraftContext {
  userId: string;
  company: any;
  founderName: string;
  template: { subject: string; body: string } | null;
}

async function draftEmails(ctx: DraftContext, matches: MatchResult[], r: RankedCompany) {
  return mapWithConcurrency(matches, 5, async (match) => {
    const inv = r.investors.get(match.investorId)!;
    if (ctx.template) {
      const email = renderTemplate(ctx.template, {
        investorName: inv.name.split(" ")[0] ?? inv.name,
        investorFullName: inv.name,
        firm: inv.firm.trim(),
        companyName: ctx.company.name,
        oneLiner: ctx.company.one_liner ?? "",
        founderName: ctx.founderName,
        matchReason: match.reasons[0] ?? "",
        askAmount: ctx.company.ask_amount_usd ? `$${Number(ctx.company.ask_amount_usd).toLocaleString("en-US")}` : "",
      });
      return { match, inv, email: { ...email, provider: "template" } };
    }
    const email = await generatePersonalizedEmail({
      founderName: ctx.founderName,
      companyName: ctx.company.name,
      oneLiner: ctx.company.one_liner ?? "",
      askAmountUsd: ctx.company.ask_amount_usd ?? 0,
      investorName: inv.name,
      investorFirm: inv.firm,
      matchReasons: match.reasons,
    });
    return { match, inv, email };
  });
}

async function insertDrafts(db: Queryable, campaignId: string, userId: string, drafted: Awaited<ReturnType<typeof draftEmails>>) {
  const out = [];
  for (const { match, inv, email } of drafted) {
    const row = (
      await db.query(
        `INSERT INTO email_sends (campaign_id, user_id, investor_id, subject, body_text, match_score, scheduled_for)
         VALUES ($1,$2,$3,$4,$5,$6, now()) RETURNING *`,
        [campaignId, userId, inv.id, email.subject, email.body, match.score]
      )
    ).rows[0];
    out.push({ ...toSendResponse(row), investorName: inv.name, investorFirm: inv.firm, matchReasons: match.reasons, provider: email.provider });
  }
  return out;
}

async function loadTemplate(userId: string, templateId: string | undefined, db: Queryable) {
  if (!templateId) return null;
  const t = (await db.query("SELECT subject, body FROM email_templates WHERE id = $1 AND user_id = $2", [templateId, userId])).rows[0];
  if (!t) throw Object.assign(new Error("Template not found."), { status: 404 });
  return t as { subject: string; body: string };
}

/**
 * Picks which investors to draft for: the founder's explicit selection (each must be an
 * eligible, not-yet-contacted match for this company) or, if none given, the best
 * not-yet-contacted matches — never more than the remaining plan allowance.
 */
function selectMatches(r: RankedCompany, investorIds: string[] | undefined, allowance: number) {
  const fresh = r.ranked.filter((m) => !r.alreadyContacted.has(m.investorId));
  if (!investorIds?.length) return { selected: fresh.slice(0, allowance), rejected: [] as string[] };
  const byId = new Map(fresh.map((m) => [m.investorId, m]));
  const rejected = investorIds.filter((id) => !byId.has(id));
  const selected = [...new Set(investorIds)].map((id) => byId.get(id)).filter((m): m is MatchResult => !!m);
  return { selected: selected.slice(0, allowance), rejected, overAllowance: Math.max(0, selected.length - allowance) };
}

const createCampaignSchema = z.object({
  companyId: z.string().min(1),
  tier: z.enum(["FREE", "STARTER", "GROWTH", "ENTERPRISE"]).optional(),
  investorIds: z.array(z.string().min(1)).max(2000).optional(),
  templateId: z.string().optional(),
  name: z.string().trim().max(120).optional(),
  /** Launch immediately instead of creating a draft for review. */
  launch: z.boolean().optional(),
});

/**
 * Creates a campaign with a personalized draft per selected investor. Drafts are QUEUED
 * emails inside a DRAFT campaign: nothing sends until the founder launches it and then
 * dispatches (which enforces Gmail, warm-up and plan limits).
 */
campaignRouter.post("/", async (req, res) => {
  const parsed = createCampaignSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input." });
  const { companyId, tier: requestedTier, investorIds, templateId, name, launch } = parsed.data;
  const userId = req.auth!.userId;

  const outcome = await withUserLock("campaign_create", userId, async (db) => {
    const entitlement = await loadEntitlement(userId, db);
    const authorization = authorizeCampaignTier(entitlement.subscription, requestedTier);
    if (!authorization.allowed) {
      return { status: 402, body: { error: authorization.reason, entitlementTier: authorization.entitlementTier, upgradeRequired: true } };
    }
    if (entitlement.quota.remainingToAllocate <= 0) {
      return {
        status: 402,
        body: {
          error:
            entitlement.quota.remainingToSend > 0
              ? `All ${entitlement.quota.limit} emails in your ${entitlement.tier} plan are already drafted in existing campaigns. Send those, or upgrade for more.`
              : `You've used all ${entitlement.quota.limit} emails included in your ${entitlement.tier} plan. Upgrade to start a new campaign.`,
          entitlementTier: entitlement.tier,
          upgradeRequired: true,
        },
      };
    }
    if (authorization.activeCampaignLimit !== null) {
      const open = (
        await db.query("SELECT COUNT(*)::int AS count FROM campaigns WHERE user_id = $1 AND status IN ('DRAFT','ACTIVE','PAUSED')", [userId])
      ).rows[0].count;
      if (open >= authorization.activeCampaignLimit) {
        return {
          status: 403,
          body: {
            error: `Your ${PRICING_TIERS[entitlement.tier].name} plan allows ${authorization.activeCampaignLimit} open campaign at a time. Finish or cancel the current one, or upgrade.`,
            entitlementTier: entitlement.tier,
            activeCampaignLimit: authorization.activeCampaignLimit,
            upgradeRequired: true,
          },
        };
      }
    }

    let template: { subject: string; body: string } | null;
    try {
      template = await loadTemplate(userId, templateId, db);
    } catch (err: any) {
      return { status: err.status ?? 400, body: { error: err.message } };
    }
    if (!template && !isAIFeatureAvailable("email")) {
      return { status: 503, body: { error: "AI drafting isn't available right now. Choose one of your email templates instead.", manualEmailRequired: true } };
    }

    const r = await rankForCompany(userId, companyId, db);
    if (!r) return { status: 404, body: { error: "Company not found." } };
    if (r === "incomplete") return { status: 400, body: { error: INCOMPLETE_PROFILE, incomplete: true } };

    const { selected, rejected } = selectMatches(r, investorIds, entitlement.quota.remainingToAllocate);
    if (investorIds?.length && rejected.length === investorIds.length) {
      return { status: 422, body: { error: "None of the selected investors are eligible matches you haven't contacted yet.", rejected } };
    }
    if (selected.length === 0) {
      return {
        status: 422,
        body: {
          error:
            r.ranked.length > 0
              ? "You've already contacted every investor that matches this company. New matches appear as the investor database grows."
              : "No verified investors match this company's stage, sector and geography yet. Try broadening your sector tags.",
          totalMatches: r.ranked.length,
        },
      };
    }

    const userRow = (await db.query("SELECT email, name FROM users WHERE id = $1", [userId])).rows[0];
    const ctx: DraftContext = { userId, company: r.company, founderName: userRow.name || userRow.email.split("@")[0], template };
    let drafted;
    try {
      drafted = await draftEmails(ctx, selected, r);
    } catch (err) {
      if (err instanceof AIProviderUnavailableError) {
        return { status: 503, body: { error: "AI drafting is temporarily unavailable. Nothing was saved — try again, or use a template.", manualEmailRequired: true } };
      }
      throw err;
    }

    await db.query("BEGIN");
    try {
      const status = launch ? "ACTIVE" : "DRAFT";
      const campaign = (
        await db.query(
          `INSERT INTO campaigns (user_id, company_id, tier, matched_investor_ids, status, name, launched_at)
           VALUES ($1,$2,$3,$4,$5,$6, CASE WHEN $5 = 'ACTIVE' THEN now() ELSE NULL END) RETURNING *`,
          [userId, companyId, entitlement.tier, selected.map((m) => m.investorId), status, name || `${r.company.name} outreach`]
        )
      ).rows[0];
      const drafts = await insertDrafts(db, campaign.id, userId, drafted);
      await createNotification(
        userId,
        "campaign_created",
        `${selected.length} outreach emails drafted for ${r.company.name}`,
        `${r.ranked.length} investors matched; ${selected.length} selected for this campaign. Review the drafts, then launch.`,
        db
      );
      await db.query("COMMIT");
      return {
        status: 201,
        body: {
          campaign: toCampaignResponse(campaign),
          drafts,
          totalMatches: r.ranked.length,
          alreadyContactedCount: r.alreadyContacted.size,
          selectedCount: selected.length,
          rejectedInvestorIds: rejected,
          tierInfo: PRICING_TIERS[entitlement.tier],
          entitlement: {
            tier: entitlement.tier,
            investorLimit: entitlement.quota.limit,
            remainingToAllocate: entitlement.quota.remainingToAllocate - selected.length,
            activeCampaignLimit: authorization.activeCampaignLimit,
          },
        },
      };
    } catch (err) {
      await db.query("ROLLBACK");
      throw err;
    }
  });

  if (!outcome.acquired) return res.status(409).json({ error: "A campaign is already being created for your account. Wait for it to finish." });
  res.status(outcome.result.status).json(outcome.result.body);
});

const addDraftsSchema = z.object({ investorIds: z.array(z.string().min(1)).min(1).max(500), templateId: z.string().optional() });

/** Adds investors to a DRAFT campaign (same eligibility and allowance rules as creation). */
campaignRouter.post("/:id/drafts", async (req, res) => {
  const parsed = addDraftsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input." });
  const userId = req.auth!.userId;
  const outcome = await withUserLock("campaign_create", userId, async (db) => {
    const campaign = (await db.query("SELECT * FROM campaigns WHERE id = $1 AND user_id = $2", [req.params.id, userId])).rows[0];
    if (!campaign) return { status: 404, body: { error: "Campaign not found." } };
    if (campaign.status !== "DRAFT") return { status: 409, body: { error: "Investors can only be added while the campaign is a draft." } };
    const entitlement = await loadEntitlement(userId, db);
    if (entitlement.quota.remainingToAllocate <= 0) return { status: 402, body: { error: "Your plan's email allowance is fully allocated.", upgradeRequired: true } };
    let template;
    try {
      template = await loadTemplate(userId, parsed.data.templateId, db);
    } catch (err: any) {
      return { status: err.status ?? 400, body: { error: err.message } };
    }
    if (!template && !isAIFeatureAvailable("email")) return { status: 503, body: { error: "AI drafting isn't available — choose a template." } };
    const r = await rankForCompany(userId, campaign.company_id, db);
    if (!r || r === "incomplete") return { status: 400, body: { error: INCOMPLETE_PROFILE } };
    const { selected, rejected } = selectMatches(r, parsed.data.investorIds, entitlement.quota.remainingToAllocate);
    if (!selected.length) return { status: 422, body: { error: "None of these investors can be added (not eligible, or already contacted).", rejected } };
    const userRow = (await db.query("SELECT email, name FROM users WHERE id = $1", [userId])).rows[0];
    let drafted;
    try {
      drafted = await draftEmails({ userId, company: r.company, founderName: userRow.name || userRow.email.split("@")[0], template }, selected, r);
    } catch (err) {
      if (err instanceof AIProviderUnavailableError) return { status: 503, body: { error: "AI drafting is temporarily unavailable." } };
      throw err;
    }
    const drafts = await insertDrafts(db, campaign.id, userId, drafted);
    await db.query("UPDATE campaigns SET matched_investor_ids = matched_investor_ids || $1::text[], updated_at = now() WHERE id = $2", [
      selected.map((m) => m.investorId),
      campaign.id,
    ]);
    return { status: 201, body: { added: drafts.length, drafts, rejectedInvestorIds: rejected } };
  });
  if (!outcome.acquired) return res.status(409).json({ error: "Another change to your campaigns is in progress." });
  res.status(outcome.result.status).json(outcome.result.body);
});

/** Removes one unsent email from a campaign (releases it back to the plan allowance). */
campaignRouter.delete("/:id/drafts/:sendId", async (req, res) => {
  const result = await pool.query(
    `UPDATE email_sends SET status = 'CANCELLED' WHERE id = $1 AND campaign_id = $2 AND user_id = $3 AND status = 'QUEUED' RETURNING id`,
    [req.params.sendId, req.params.id, req.auth!.userId]
  );
  if (!result.rows.length) return res.status(409).json({ error: "Only unsent emails can be removed." });
  res.json({ ok: true });
});

campaignRouter.post("/:id/launch", async (req, res) => {
  const userId = req.auth!.userId;
  const queued = (
    await pool.query("SELECT COUNT(*)::int AS n FROM email_sends WHERE campaign_id = $1 AND user_id = $2 AND status = 'QUEUED'", [req.params.id, userId])
  ).rows[0].n;
  if (queued === 0) {
    const exists = (await pool.query("SELECT status FROM campaigns WHERE id = $1 AND user_id = $2", [req.params.id, userId])).rows[0];
    if (!exists) return res.status(404).json({ error: "Campaign not found." });
    return res.status(409).json({ error: "Add at least one investor before launching." });
  }
  const updated = await pool.query(
    "UPDATE campaigns SET status = 'ACTIVE', launched_at = now(), updated_at = now() WHERE id = $1 AND user_id = $2 AND status = 'DRAFT' RETURNING *",
    [req.params.id, userId]
  );
  if (!updated.rows.length) {
    const exists = (await pool.query("SELECT status FROM campaigns WHERE id = $1 AND user_id = $2", [req.params.id, userId])).rows[0];
    if (!exists) return res.status(404).json({ error: "Campaign not found." });
    return res.status(409).json({ error: `This campaign is already ${exists.status.toLowerCase()}.` });
  }
  res.json({ campaign: toCampaignResponse(updated.rows[0]) });
});

campaignRouter.get("/", async (req, res) => {
  const userId = req.auth!.userId;
  const result = await pool.query(
    `SELECT c.*, comp.name AS company_name,
            COUNT(es.id) FILTER (WHERE es.status <> 'CANCELLED')::int AS total_sends,
            COUNT(es.id) FILTER (WHERE es.status = 'QUEUED')::int AS queued,
            COUNT(es.id) FILTER (WHERE es.sent_at IS NOT NULL)::int AS sent,
            COUNT(es.id) FILTER (WHERE es.status = 'FAILED')::int AS failed,
            COUNT(es.id) FILTER (WHERE es.status = 'BOUNCED')::int AS bounced,
            COUNT(es.id) FILTER (WHERE es.status = 'REPLIED')::int AS replied
     FROM campaigns c
     JOIN companies comp ON comp.id = c.company_id
     LEFT JOIN email_sends es ON es.campaign_id = c.id
     WHERE c.user_id = $1
     GROUP BY c.id, comp.name
     ORDER BY c.created_at DESC`,
    [userId]
  );
  res.json(
    result.rows.map((r) => ({
      ...toCampaignResponse(r),
      companyName: r.company_name,
      counts: { total: r.total_sends, queued: r.queued, sent: r.sent, failed: r.failed, bounced: r.bounced, replied: r.replied },
    }))
  );
});

campaignRouter.get("/:id", async (req, res) => {
  const userId = req.auth!.userId;
  const campaign = (
    await pool.query("SELECT c.*, comp.name AS company_name FROM campaigns c JOIN companies comp ON comp.id = c.company_id WHERE c.id = $1 AND c.user_id = $2", [
      req.params.id,
      userId,
    ])
  ).rows[0];
  if (!campaign) return res.status(404).json({ error: "Campaign not found." });

  const sends = (
    await pool.query(
      `SELECT es.*, i.name AS investor_name, i.firm AS investor_firm, i.title AS investor_title
       FROM email_sends es JOIN investors i ON i.id = es.investor_id
       WHERE es.campaign_id = $1 ORDER BY es.match_score DESC`,
      [campaign.id]
    )
  ).rows;

  // Activity timeline, derived from real timestamps only.
  const timeline: { at: string; kind: string; label: string }[] = [{ at: campaign.created_at, kind: "created", label: `Campaign created with ${sends.length} drafts` }];
  if (campaign.launched_at) timeline.push({ at: campaign.launched_at, kind: "launched", label: "Campaign launched" });
  const sentByMinute = new Map<string, number>();
  for (const s of sends) {
    if (s.sent_at) {
      const minute = new Date(s.sent_at).toISOString().slice(0, 16);
      sentByMinute.set(minute, (sentByMinute.get(minute) ?? 0) + 1);
    }
    if (s.replied_at) timeline.push({ at: s.replied_at, kind: "replied", label: `${s.investor_name} (${s.investor_firm}) replied` });
    if (s.bounced_at) timeline.push({ at: s.bounced_at, kind: "bounced", label: `Email to ${s.investor_name} bounced` });
  }
  for (const [minute, n] of sentByMinute) timeline.push({ at: `${minute}:00.000Z`, kind: "sent", label: `${n} email${n === 1 ? "" : "s"} sent` });
  timeline.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  res.json({
    campaign: { ...toCampaignResponse(campaign), companyName: campaign.company_name, launchedAt: campaign.launched_at },
    sends: sends.map((r) => ({
      ...toSendResponse(r),
      investorName: r.investor_name,
      investorFirm: r.investor_firm,
      investorTitle: r.investor_title,
      fundKey: fundKey(r.investor_firm),
      repliedAt: r.replied_at,
      bouncedAt: r.bounced_at,
      gmailThreadId: r.gmail_thread_id,
    })),
    timeline,
  });
});

const statusActionSchema = z.object({ action: z.enum(["pause", "resume", "cancel"]) });

const TRANSITIONS: Record<string, { from: string[]; to: string }> = {
  pause: { from: ["ACTIVE"], to: "PAUSED" },
  resume: { from: ["PAUSED"], to: "ACTIVE" },
  cancel: { from: ["DRAFT", "ACTIVE", "PAUSED"], to: "CANCELLED" },
};

campaignRouter.post("/:id/status", async (req, res) => {
  const parsed = statusActionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "action must be pause, resume or cancel." });
  const transition = TRANSITIONS[parsed.data.action]!;
  const userId = req.auth!.userId;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query(
      `UPDATE campaigns SET status = $1, updated_at = now() WHERE id = $2 AND user_id = $3 AND status = ANY($4) RETURNING *`,
      [transition.to, req.params.id, userId, transition.from]
    );
    if (updated.rows.length === 0) {
      await client.query("ROLLBACK");
      const exists = (await pool.query("SELECT status FROM campaigns WHERE id = $1 AND user_id = $2", [req.params.id, userId])).rows[0];
      if (!exists) return res.status(404).json({ error: "Campaign not found." });
      return res.status(409).json({ error: `Can't ${parsed.data.action} a ${exists.status.toLowerCase()} campaign.` });
    }
    let cancelledSends = 0;
    if (transition.to === "CANCELLED") {
      cancelledSends =
        (await client.query("UPDATE email_sends SET status = 'CANCELLED' WHERE campaign_id = $1 AND status IN ('QUEUED','FAILED')", [req.params.id])).rowCount ?? 0;
    }
    await client.query("COMMIT");
    res.json({ campaign: toCampaignResponse(updated.rows[0]), cancelledSends });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

campaignRouter.post("/:id/retry-failed", async (req, res) => {
  const userId = req.auth!.userId;
  const campaign = (await pool.query("SELECT * FROM campaigns WHERE id = $1 AND user_id = $2", [req.params.id, userId])).rows[0];
  if (!campaign) return res.status(404).json({ error: "Campaign not found." });
  if (campaign.status === "CANCELLED") return res.status(409).json({ error: "This campaign was cancelled." });

  const requeued = await pool.query(
    `UPDATE email_sends SET status = 'QUEUED', failure_reason = NULL
     WHERE campaign_id = $1 AND user_id = $2 AND status = 'FAILED' AND sent_at IS NULL RETURNING id`,
    [campaign.id, userId]
  );
  if (campaign.status === "COMPLETED" && requeued.rows.length > 0) {
    await pool.query("UPDATE campaigns SET status = 'ACTIVE', updated_at = now() WHERE id = $1", [campaign.id]);
  }
  await markCampaignCompletedIfDone(campaign.id);
  res.json({ requeued: requeued.rows.length });
});

function toCampaignResponse(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name ?? null,
    tier: row.tier,
    matchedInvestorCount: row.matched_investor_ids?.length ?? 0,
    status: row.status,
    createdAt: row.created_at,
    launchedAt: row.launched_at ?? null,
  };
}

function toSendResponse(row: any) {
  return {
    id: row.id,
    investorId: row.investor_id,
    subject: row.subject,
    bodyText: row.body_text,
    matchScore: row.match_score,
    status: row.status,
    failureReason: row.failure_reason ?? null,
    scheduledFor: row.scheduled_for,
    sentAt: row.sent_at,
  };
}
