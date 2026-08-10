import { Router } from "express";
import { z } from "zod";
import { pool } from "../lib/db";
import { requireAuth } from "../lib/auth";
import { rankInvestors, resolveMatchingKeywords, CompanyProfile, InvestorProfile, WarmthRecord } from "../services/matchingService";
import { AIProviderUnavailableError, generatePersonalizedEmail, isAIFeatureAvailable } from "../lib/llmService";
import { authorizeCampaignTier, PRICING_TIERS } from "../services/pricingService";
import { createNotification } from "./notifications";

export const campaignRouter = Router();
campaignRouter.use(requireAuth);

const createCampaignSchema = z.object({
  companyId: z.string(),
  tier: z.enum(["STARTER", "GROWTH", "ENTERPRISE"]),
});

campaignRouter.get("/preview/:companyId", async (req, res) => {
  const userId = req.auth!.userId;
  const companyResult = await pool.query("SELECT * FROM companies WHERE id = $1 AND user_id = $2", [
    req.params.companyId,
    userId,
  ]);
  const companyRow = companyResult.rows[0];
  if (!companyRow) return res.status(404).json({ error: "Company not found." });

  const effectiveKeywords = resolveMatchingKeywords(companyRow.extracted_keywords, companyRow.sector);
  if (!effectiveKeywords || effectiveKeywords.length === 0) {
    return res.status(400).json({ error: "Add at least one sector tag before previewing investors." });
  }

  const verifiedRows = await pool.query("SELECT * FROM investors WHERE is_verified = true AND needs_enrichment = false");
  const investors: InvestorProfile[] = verifiedRows.rows.map(toInvestorProfile);
  const warmthRows = await pool.query("SELECT investor_id, status FROM investor_warmth WHERE user_id = $1", [userId]);
  const warmthMap = new Map<string, WarmthRecord>(
    warmthRows.rows.map((w) => [w.investor_id, { investorId: w.investor_id, status: w.status }])
  );

  const companyProfile: CompanyProfile = {
    stage: companyRow.stage,
    sector: companyRow.sector,
    geography: companyRow.geography,
    askAmountUsd: companyRow.ask_amount_usd,
    extractedKeywords: effectiveKeywords,
  };

  const ranked = rankInvestors(companyProfile, investors, warmthMap, 5);
  if (ranked.length > 0) {
    const byId = new Map(investors.map((i) => [i.id, i]));
    return res.json({
      total: ranked.length,
      qualifiedTotal: verifiedRows.rowCount,
      mode: "verified",
      investors: ranked.map((m) => {
        const investor = byId.get(m.investorId)!;
        return {
          id: investor.id,
          name: investor.name,
          firm: investor.firm,
          score: m.score,
          reasons: m.reasons,
        };
      }),
    });
  }

  const fallback = await pool.query(
    `SELECT id, name, firm FROM investors
     WHERE id NOT IN (
       SELECT investor_id FROM investor_warmth WHERE user_id = $1 AND status = 'REPLIED_PASS'
     )
     ORDER BY source_verified_at DESC, created_at ASC
     LIMIT 5`,
    [userId]
  );
  const total = await pool.query("SELECT count(*)::int AS total FROM investors");
  res.json({
    total: total.rows[0].total,
    qualifiedTotal: 0,
    mode: "imported",
    investors: fallback.rows.map((i) => ({
      id: i.id,
      name: i.name,
      firm: i.firm,
      score: null,
      reasons: ["Imported investor contact. Thesis enrichment is pending."],
    })),
  });
});

/**
 * Creates a campaign: scores every verified investor against the company, takes the
 * top N for the tier, generates a personalized email for each, and queues them.
 * Nothing is actually sent here — sending is a separate step via /api/sends, gated by
 * sendScheduler.ts's rate limits. This route only does matching + drafting.
 */
campaignRouter.post("/", async (req, res) => {
  const parsed = createCampaignSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input." });
  }
  const { companyId, tier } = parsed.data;
  const userId = req.auth!.userId;

  const subscription = (
    await pool.query("SELECT tier, status, current_period_end FROM subscriptions WHERE user_id = $1", [userId])
  ).rows[0];
  const authorization = authorizeCampaignTier(subscription, tier);
  if (!authorization.allowed) {
    return res.status(402).json({
      error: authorization.reason,
      entitlementTier: authorization.entitlementTier,
      requiredTier: tier,
    });
  }

  if (!isAIFeatureAvailable("email")) {
    console.error("[campaign] AI email generation unavailable: no provider configured for email feature");
    return res.status(503).json({
      error: "AI email generation is not available right now. Draft emails manually or try again later.",
      manualEmailRequired: true,
    });
  }

  if (authorization.activeCampaignLimit !== null) {
    const activeCampaigns = await pool.query(
      "SELECT COUNT(*)::int AS count FROM campaigns WHERE user_id = $1 AND status = 'ACTIVE'",
      [userId]
    );
    if (activeCampaigns.rows[0].count >= authorization.activeCampaignLimit) {
      return res.status(403).json({
        error: `Your ${authorization.entitlementTier} plan allows ${authorization.activeCampaignLimit} active campaign.`,
        entitlementTier: authorization.entitlementTier,
        activeCampaignLimit: authorization.activeCampaignLimit,
      });
    }
  }

  const companyResult = await pool.query("SELECT * FROM companies WHERE id = $1 AND user_id = $2", [
    companyId,
    userId,
  ]);
  const companyRow = companyResult.rows[0];
  if (!companyRow) return res.status(404).json({ error: "Company not found." });

  // A company that used the deck-upload fallback (no AI key configured) never gets
  // extracted_keywords populated by generation — see resolveMatchingKeywords for why.
  const effectiveKeywords = resolveMatchingKeywords(companyRow.extracted_keywords, companyRow.sector);

  if (!effectiveKeywords || effectiveKeywords.length === 0) {
    return res.status(400).json({
      error: "Add at least one sector tag to your company profile before matching investors.",
    });
  }

  const companyProfile: CompanyProfile = {
    stage: companyRow.stage,
    sector: companyRow.sector,
    geography: companyRow.geography,
    askAmountUsd: companyRow.ask_amount_usd,
    extractedKeywords: effectiveKeywords,
  };

  // needs_enrichment investors have no real stage/sector/geo data (see importInvestors.ts) —
  // excluding them here, not just scoring them low, so the matching list never shows a
  // founder a "match" grounded in nothing.
  const investorRows = await pool.query("SELECT * FROM investors WHERE is_verified = true AND needs_enrichment = false");
  const investors: InvestorProfile[] = investorRows.rows.map(toInvestorProfile);

  const warmthRows = await pool.query("SELECT investor_id, status FROM investor_warmth WHERE user_id = $1", [
    userId,
  ]);
  const warmthMap = new Map<string, WarmthRecord>(
    warmthRows.rows.map((w) => [w.investor_id, { investorId: w.investor_id, status: w.status }])
  );

  const limit = authorization.investorLimit;
  let matches = rankInvestors(companyProfile, investors, warmthMap, limit);
  let fallbackInvestors: InvestorProfile[] = [];

  if (matches.length === 0) {
    const fallbackRows = await pool.query(
      `SELECT * FROM investors
       WHERE id NOT IN (
         SELECT investor_id FROM investor_warmth WHERE user_id = $1 AND status = 'REPLIED_PASS'
       )
       ORDER BY source_verified_at DESC, created_at ASC
       LIMIT $2`,
      [userId, limit]
    );
    fallbackInvestors = fallbackRows.rows.map((row) => ({
      ...toInvestorProfile(row),
      isVerified: true,
    }));
    matches = fallbackInvestors.map((investor) => ({
      investorId: investor.id,
      score: 10,
      breakdown: { stageFit: 0, sectorFit: 0, geoFit: 0, checkSizeFit: 0, recencyFit: 0, warmthBonus: 0 },
      reasons: ["Imported investor contact. Thesis enrichment is pending."],
      excluded: false,
    }));
    if (matches.length === 0) {
      return res.status(422).json({
        error: "No investors are available yet. Import investor contacts or add investors in admin first.",
      });
    }
  }

  const investorById = new Map([...investors, ...fallbackInvestors].map((i) => [i.id, i]));
  const userRow = (await pool.query("SELECT email, name FROM users WHERE id = $1", [userId])).rows[0];
  const founderName = userRow.name || userRow.email.split("@")[0]; // fallback for accounts created before the name field existed

  const generatedEmails = [];
  for (const match of matches) {
    const investor = investorById.get(match.investorId)!;
    try {
      const email = await generatePersonalizedEmail({
        founderName,
        companyName: companyRow.name,
        oneLiner: companyRow.one_liner,
        askAmountUsd: companyRow.ask_amount_usd,
        investorName: investor.name,
        investorFirm: investor.firm,
        matchReasons: match.reasons,
      });
      generatedEmails.push({ match, investor, email });
    } catch (err) {
      if (err instanceof AIProviderUnavailableError) {
        console.error("[campaign] AI email generation failed for all providers:", err.message, "attempted:", err.attemptedProviders);
        return res.status(503).json({
          error: "AI email generation is temporarily unavailable. Draft emails manually or try again later.",
          manualEmailRequired: true,
        });
      }
      throw err;
    }
  }

  const campaignResult = await pool.query(
    `INSERT INTO campaigns (user_id, company_id, tier, matched_investor_ids) VALUES ($1,$2,$3,$4) RETURNING *`,
    [userId, companyId, tier, matches.map((m) => m.investorId)]
  );
  const campaign = campaignResult.rows[0];

  const draftedSends = [];
  for (const { match, investor, email } of generatedEmails) {
    const sendResult = await pool.query(
      `INSERT INTO email_sends (campaign_id, user_id, investor_id, subject, body_text, match_score, scheduled_for)
       VALUES ($1,$2,$3,$4,$5,$6, now()) RETURNING *`,
      [campaign.id, userId, investor.id, email.subject, email.body, match.score]
    );
    draftedSends.push({ ...toSendResponse(sendResult.rows[0]), matchReasons: match.reasons, provider: email.provider });
  }

  await createNotification(
    userId,
    "campaign_created",
    `${matches.length} investors matched for ${companyRow.name}`,
    `Your ${tier.toLowerCase()} campaign found ${matches.length} matched investors and drafted personalized outreach for each.`
  );

  res.status(201).json({
    campaign: toCampaignResponse(campaign),
    drafts: draftedSends,
    tierInfo: PRICING_TIERS[tier],
    entitlement: {
      tier: authorization.entitlementTier,
      investorLimit: authorization.investorLimit,
      activeCampaignLimit: authorization.activeCampaignLimit,
    },
  });
});

campaignRouter.get("/", async (req, res) => {
  const userId = req.auth!.userId;
  const result = await pool.query(
    `SELECT c.*, comp.name AS company_name FROM campaigns c
     JOIN companies comp ON comp.id = c.company_id
     WHERE c.user_id = $1 ORDER BY c.created_at DESC`,
    [userId]
  );
  res.json(result.rows.map((r) => ({ ...toCampaignResponse(r), companyName: r.company_name })));
});

campaignRouter.get("/:id", async (req, res) => {
  const userId = req.auth!.userId;
  const campaignResult = await pool.query("SELECT * FROM campaigns WHERE id = $1 AND user_id = $2", [
    req.params.id,
    userId,
  ]);
  const campaign = campaignResult.rows[0];
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
    lastKnownActiveAt: row.last_known_active_at,
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
    scheduledFor: row.scheduled_for,
    sentAt: row.sent_at,
  };
}
