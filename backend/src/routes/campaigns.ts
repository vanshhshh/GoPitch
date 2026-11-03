import { Router } from "express";
import { z } from "zod";
import { pool, Queryable, withUserLock } from "../lib/db";
import { requireAuth } from "../lib/auth";
import { rankInvestors, resolveMatchingKeywords, CompanyProfile, InvestorProfile, WarmthRecord, MatchResult } from "../services/matchingService";
import { AIProviderUnavailableError, generatePersonalizedEmail, isAIFeatureAvailable } from "../lib/llmService";
import { authorizeCampaignTier, PRICING_TIERS } from "../services/pricingService";
import { loadEntitlement } from "../services/entitlementService";
import { createNotification } from "./notifications";
import { markCampaignCompletedIfDone } from "./sends";

export const campaignRouter = Router();
campaignRouter.use(requireAuth);

const createCampaignSchema = z.object({
  companyId: z.string().min(1),
  // Optional and advisory: the tier the client believes the founder is on. The campaign
  // always uses the founder's real entitlement; a higher requested tier is refused.
  tier: z.enum(["FREE", "STARTER", "GROWTH", "ENTERPRISE"]).optional(),
});

/** Same normalization as the "funds matched" count, so one fund under two spellings counts once. */
function fundKey(firm: string | null | undefined): string {
  return (firm || "").trim().toLowerCase().replace(/\s+/g, " ");
}

interface RankedCompany {
  company: any;
  investors: Map<string, InvestorProfile>;
  ranked: MatchResult[];
  alreadyContacted: Set<string>;
}

/**
 * Scores every matchable investor (verified, enriched) for one of the founder's companies.
 * Returns null when the company doesn't exist or isn't theirs. Investors the founder has
 * already emailed (or drafted for) in any campaign are flagged, so a new campaign never
 * re-pitches them.
 */
async function rankForCompany(userId: string, companyId: string, db: Queryable = pool): Promise<RankedCompany | "no_keywords" | null> {
  const company = (await db.query("SELECT * FROM companies WHERE id = $1 AND user_id = $2", [companyId, userId])).rows[0];
  if (!company) return null;

  const effectiveKeywords = resolveMatchingKeywords(company.extracted_keywords, company.sector);
  if (!effectiveKeywords || effectiveKeywords.length === 0) return "no_keywords";

  // needs_enrichment investors have no real stage/sector/geo data — they are excluded, not
  // scored low, so a founder is never shown a "match" grounded in nothing.
  const investorRows = await db.query("SELECT * FROM investors WHERE is_verified = true AND needs_enrichment = false");
  const investors = new Map<string, InvestorProfile>(investorRows.rows.map((row) => [row.id, toInvestorProfile(row)]));

  const warmthRows = await db.query("SELECT investor_id, status FROM investor_warmth WHERE user_id = $1", [userId]);
  const warmthMap = new Map<string, WarmthRecord>(
    warmthRows.rows.map((w) => [w.investor_id, { investorId: w.investor_id, status: w.status }])
  );

  const contactedRows = await db.query(
    "SELECT DISTINCT investor_id FROM email_sends WHERE user_id = $1 AND status <> 'CANCELLED'",
    [userId]
  );

  const profile: CompanyProfile = {
    stage: company.stage,
    sector: company.sector,
    geography: company.geography,
    askAmountUsd: company.ask_amount_usd,
    extractedKeywords: effectiveKeywords,
  };

  return {
    company,
    investors,
    ranked: rankInvestors(profile, [...investors.values()], warmthMap, investors.size),
    alreadyContacted: new Set(contactedRows.rows.map((r) => r.investor_id)),
  };
}

function toMatchResponse(match: MatchResult, investor: InvestorProfile, alreadyContacted: boolean) {
  return {
    id: investor.id,
    name: investor.name,
    firm: investor.firm,
    score: match.score,
    breakdown: match.breakdown,
    reasons: match.reasons,
    alreadyContacted,
  };
}

async function matchableInvestorCount(): Promise<number> {
  return (
    await pool.query("SELECT COUNT(*)::int AS n FROM investors WHERE is_verified = true AND needs_enrichment = false")
  ).rows[0].n;
}

/** Overview: totals over ALL matches + the top 5. */
campaignRouter.get("/preview/:companyId", async (req, res) => {
  const userId = req.auth!.userId;
  const ranking = await rankForCompany(userId, req.params.companyId);
  if (!ranking) return res.status(404).json({ error: "Company not found." });
  if (ranking === "no_keywords") return res.status(400).json({ error: "Add at least one sector tag before previewing investors." });

  const { ranked, investors, alreadyContacted } = ranking;
  const entitlement = await loadEntitlement(userId);
  const newMatches = ranked.filter((m) => !alreadyContacted.has(m.investorId));

  res.json({
    mode: "verified",
    totalMatches: ranked.length,
    totalFundsMatched: new Set(ranked.map((m) => fundKey(investors.get(m.investorId)?.firm))).size,
    alreadyContactedCount: ranked.length - newMatches.length,
    // How many of the matches the next campaign would actually draft for, given the plan.
    nextCampaignSize: Math.min(newMatches.length, entitlement.quota.remainingToAllocate),
    matchableInvestorCount: await matchableInvestorCount(),
    entitlement: {
      tier: entitlement.tier,
      investorLimit: entitlement.quota.limit,
      remainingToAllocate: entitlement.quota.remainingToAllocate,
    },
    investors: ranked.slice(0, 5).map((m) => toMatchResponse(m, investors.get(m.investorId)!, alreadyContacted.has(m.investorId))),
  });
});

const matchesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  minScore: z.coerce.number().min(0).max(100).default(0),
  q: z.string().trim().max(100).optional(),
  hideContacted: z.enum(["true", "false"]).default("false"),
});

/** "View all matches": the complete ranked list, paginated and filterable. */
campaignRouter.get("/matches/:companyId", async (req, res) => {
  const parsed = matchesQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid query." });
  const { page, pageSize, minScore, q, hideContacted } = parsed.data;

  const ranking = await rankForCompany(req.auth!.userId, req.params.companyId);
  if (!ranking) return res.status(404).json({ error: "Company not found." });
  if (ranking === "no_keywords") return res.status(400).json({ error: "Add at least one sector tag before matching investors." });

  const { ranked, investors, alreadyContacted } = ranking;
  const needle = q?.toLowerCase();
  const filtered = ranked.filter((m) => {
    if (m.score < minScore) return false;
    if (hideContacted === "true" && alreadyContacted.has(m.investorId)) return false;
    if (needle) {
      const inv = investors.get(m.investorId)!;
      if (!inv.name.toLowerCase().includes(needle) && !inv.firm.toLowerCase().includes(needle)) return false;
    }
    return true;
  });

  res.json({
    total: filtered.length,
    totalMatches: ranked.length,
    totalFundsMatched: new Set(ranked.map((m) => fundKey(investors.get(m.investorId)?.firm))).size,
    page,
    pageSize,
    items: filtered
      .slice((page - 1) * pageSize, page * pageSize)
      .map((m) => toMatchResponse(m, investors.get(m.investorId)!, alreadyContacted.has(m.investorId))),
  });
});

/** Runs async work over items with at most `limit` in flight. Keeps 100 AI calls from taking 100× as long. */
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

/**
 * Creates a campaign: takes the best-matched investors the founder hasn't contacted yet —
 * as many as their remaining plan allowance permits — drafts a personalized email for
 * each, and queues them. Nothing is sent here; sending is /api/sends/.../dispatch.
 */
campaignRouter.post("/", async (req, res) => {
  const parsed = createCampaignSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input." });
  }
  const { companyId, tier: requestedTier } = parsed.data;
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
      const active = (
        await db.query("SELECT COUNT(*)::int AS count FROM campaigns WHERE user_id = $1 AND status IN ('ACTIVE','PAUSED')", [userId])
      ).rows[0].count;
      if (active >= authorization.activeCampaignLimit) {
        return {
          status: 403,
          body: {
            error: `Your ${PRICING_TIERS[entitlement.tier].name} plan allows ${authorization.activeCampaignLimit} active campaign at a time. Finish or cancel the current one, or upgrade.`,
            entitlementTier: entitlement.tier,
            activeCampaignLimit: authorization.activeCampaignLimit,
            upgradeRequired: true,
          },
        };
      }
    }

    if (!isAIFeatureAvailable("email")) {
      return { status: 503, body: { error: "AI email generation is not configured right now. Try again later.", manualEmailRequired: true } };
    }

    const ranking = await rankForCompany(userId, companyId, db);
    if (!ranking) return { status: 404, body: { error: "Company not found." } };
    if (ranking === "no_keywords") {
      return { status: 400, body: { error: "Add at least one sector tag to your company profile before matching investors." } };
    }

    const { company, investors, ranked, alreadyContacted } = ranking;
    const selected = ranked.filter((m) => !alreadyContacted.has(m.investorId)).slice(0, entitlement.quota.remainingToAllocate);
    if (selected.length === 0) {
      return {
        status: 422,
        body: {
          error:
            ranked.length > 0
              ? "You've already contacted every investor that matches this company. New matches appear as the investor database grows."
              : "No verified investors match this company's stage, sector and geography yet. Try broadening your sector tags.",
          totalMatches: ranked.length,
        },
      };
    }

    const userRow = (await db.query("SELECT email, name FROM users WHERE id = $1", [userId])).rows[0];
    const founderName = userRow.name || userRow.email.split("@")[0];

    let generated;
    try {
      generated = await mapWithConcurrency(selected, 5, async (match) => {
        const investor = investors.get(match.investorId)!;
        const email = await generatePersonalizedEmail({
          founderName,
          companyName: company.name,
          oneLiner: company.one_liner,
          askAmountUsd: company.ask_amount_usd,
          investorName: investor.name,
          investorFirm: investor.firm,
          matchReasons: match.reasons,
        });
        return { match, investor, email };
      });
    } catch (err) {
      if (err instanceof AIProviderUnavailableError) {
        return {
          status: 503,
          body: { error: "AI email generation is temporarily unavailable. Nothing was saved — try again in a few minutes.", manualEmailRequired: true },
        };
      }
      throw err;
    }

    // Campaign + drafts are written atomically: either all drafts exist or none do.
    await db.query("BEGIN");
    try {
      const campaign = (
        await db.query(
          `INSERT INTO campaigns (user_id, company_id, tier, matched_investor_ids) VALUES ($1,$2,$3,$4) RETURNING *`,
          [userId, companyId, entitlement.tier, selected.map((m) => m.investorId)]
        )
      ).rows[0];

      const drafts = [];
      for (const { match, investor, email } of generated) {
        const row = (
          await db.query(
            `INSERT INTO email_sends (campaign_id, user_id, investor_id, subject, body_text, match_score, scheduled_for)
             VALUES ($1,$2,$3,$4,$5,$6, now()) RETURNING *`,
            [campaign.id, userId, investor.id, email.subject, email.body, match.score]
          )
        ).rows[0];
        drafts.push({ ...toSendResponse(row), investorName: investor.name, investorFirm: investor.firm, matchReasons: match.reasons, provider: email.provider });
      }

      await createNotification(
        userId,
        "campaign_created",
        `${selected.length} outreach emails drafted for ${company.name}`,
        `${ranked.length} investors matched; ${selected.length} selected for this campaign based on fit and your ${PRICING_TIERS[entitlement.tier].name} plan allowance.`,
        db
      );
      await db.query("COMMIT");

      return {
        status: 201,
        body: {
          campaign: toCampaignResponse(campaign),
          drafts,
          totalMatches: ranked.length,
          alreadyContactedCount: alreadyContacted.size,
          selectedCount: selected.length,
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

  if (!outcome.acquired) {
    return res.status(409).json({ error: "A campaign is already being created for your account. Wait for it to finish." });
  }
  res.status(outcome.result.status).json(outcome.result.body);
});

campaignRouter.get("/", async (req, res) => {
  const userId = req.auth!.userId;
  const result = await pool.query(
    `SELECT c.*, comp.name AS company_name,
            COUNT(es.id)::int AS total_sends,
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
  const campaign = (await pool.query("SELECT * FROM campaigns WHERE id = $1 AND user_id = $2", [req.params.id, userId])).rows[0];
  if (!campaign) return res.status(404).json({ error: "Campaign not found." });

  const sendsResult = await pool.query(
    `SELECT es.*, i.name AS investor_name, i.firm AS investor_firm
     FROM email_sends es JOIN investors i ON i.id = es.investor_id
     WHERE es.campaign_id = $1 ORDER BY es.match_score DESC`,
    [campaign.id]
  );

  res.json({
    campaign: toCampaignResponse(campaign),
    sends: sendsResult.rows.map((r) => ({ ...toSendResponse(r), investorName: r.investor_name, investorFirm: r.investor_firm })),
  });
});

const statusActionSchema = z.object({ action: z.enum(["pause", "resume", "cancel"]) });

// Allowed transitions; anything else is a 409 rather than a silent overwrite.
const TRANSITIONS: Record<string, { from: string[]; to: string }> = {
  pause: { from: ["ACTIVE"], to: "PAUSED" },
  resume: { from: ["PAUSED"], to: "ACTIVE" },
  cancel: { from: ["ACTIVE", "PAUSED"], to: "CANCELLED" },
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
      // Unsent drafts are released (they stop counting against the plan allowance); sent history is untouched.
      cancelledSends = (
        await client.query("UPDATE email_sends SET status = 'CANCELLED' WHERE campaign_id = $1 AND status IN ('QUEUED','FAILED')", [
          req.params.id,
        ])
      ).rowCount ?? 0;
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

/** Re-queues FAILED drafts that never left the outbox. They go through the same caps on dispatch. */
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

function toInvestorProfile(row: any): InvestorProfile {
  return {
    id: row.id,
    name: row.name,
    firm: row.firm,
    stageFocus: row.stage_focus,
    sectorFocus: row.sector_focus,
    geoFocus: row.geo_focus,
    checkSizeMinUsd: row.check_size_min_usd,
    checkSizeMaxUsd: row.check_size_max_usd,
    thesisKeywords: row.thesis_keywords,
    lastKnownActiveAt: row.last_known_active_at ? new Date(row.last_known_active_at) : null,
    isVerified: row.is_verified,
  };
}

function toCampaignResponse(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    tier: row.tier,
    matchedInvestorCount: row.matched_investor_ids?.length ?? 0,
    status: row.status,
    createdAt: row.created_at,
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
