import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { pool } from "../lib/db";
import { requireAuth, requireAdmin } from "../lib/auth";
import { publicWriteRateLimiter } from "../lib/rateLimiters";
import { checkGmailRepliesForAllUsers } from "../services/gmailWatcher";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export const adminRouter = Router();

/**
 * Public contact form submission — no auth, since a visitor emailing support isn't
 * logged in yet. Mounted on adminRouter but before the requireAuth gate below so
 * app.ts doesn't need a third router just for one public endpoint.
 */
const contactSchema = z.object({
  email: z.string().email(),
  subject: z.string().min(1).max(200),
  message: z.string().min(1).max(5000),
});

adminRouter.post("/contact", publicWriteRateLimiter, async (req, res) => {
  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const { email, subject, message } = parsed.data;
  await pool.query("INSERT INTO support_messages (email, subject, message) VALUES ($1,$2,$3)", [
    email,
    subject,
    message,
  ]);
  res.status(201).json({ ok: true });
});

adminRouter.use(requireAuth, requireAdmin);

// ---------- Platform metrics (the admin homepage) ----------

adminRouter.get("/metrics", async (_req, res) => {
  const [users, companies, campaigns, sends, investors, unverifiedInvestors] = await Promise.all([
    pool.query("SELECT COUNT(*)::int AS n FROM users WHERE role = 'FOUNDER'"),
    pool.query("SELECT COUNT(*)::int AS n FROM companies"),
    pool.query("SELECT COUNT(*)::int AS n FROM campaigns"),
    pool.query("SELECT status, COUNT(*)::int AS n FROM email_sends GROUP BY status"),
    pool.query("SELECT COUNT(*)::int AS n FROM investors"),
    pool.query("SELECT COUNT(*)::int AS n FROM investors WHERE is_verified = false"),
  ]);

  const sendsByStatus: Record<string, number> = {};
  for (const row of sends.rows) sendsByStatus[row.status] = row.n;

  const flaggedUsers = await pool.query(
    `SELECT id, email, send_reputation_score, complaint_reported_at FROM users
     WHERE send_reputation_score < 0.6 OR complaint_reported_at IS NOT NULL`
  );

  res.json({
    founderCount: users.rows[0].n,
    companyCount: companies.rows[0].n,
    campaignCount: campaigns.rows[0].n,
    sendsByStatus,
    investorCount: investors.rows[0].n,
    unverifiedInvestorCount: unverifiedInvestors.rows[0].n,
    flaggedUsers: flaggedUsers.rows.map((u) => ({
      id: u.id,
      email: u.email,
      sendReputationScore: u.send_reputation_score,
      complaintReportedAt: u.complaint_reported_at,
    })),
  });
});

/** Platform-wide send volume over the last 30 days, for the admin Analytics page. Real
 * aggregated data only — no estimated or synthetic figures. */
adminRouter.get("/analytics", async (_req, res) => {
  const sentByDay = await pool.query(
    `SELECT date_trunc('day', sent_at) AS day, COUNT(*)::int AS count
     FROM email_sends WHERE status = 'SENT' AND sent_at >= now() - interval '30 days'
     GROUP BY day ORDER BY day`
  );
  const campaignsByTier = await pool.query(
    `SELECT tier, COUNT(*)::int AS count FROM campaigns GROUP BY tier`
  );
  const investorEnrichment = await pool.query(
    `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE needs_enrichment)::int AS needs_enrichment FROM investors`
  );

  res.json({
    sentByDay: sentByDay.rows.map((r) => ({ date: r.day, count: r.count })),
    campaignsByTier: Object.fromEntries(campaignsByTier.rows.map((r) => [r.tier, r.count])),
    investorEnrichment: {
      total: investorEnrichment.rows[0].total,
      needsEnrichment: investorEnrichment.rows[0].needs_enrichment,
    },
  });
});

// ---------- Investor management ----------

adminRouter.get("/investors", async (req, res) => {
  const verified = req.query.verified as string | undefined;
  let query = "SELECT * FROM investors";
  const params: any[] = [];
  if (verified === "true" || verified === "false") {
    query += " WHERE is_verified = $1";
    params.push(verified === "true");
  }
  query += " ORDER BY created_at DESC LIMIT 500";
  const result = await pool.query(query, params);
  res.json(result.rows.map(toInvestorResponse));
});

const createInvestorSchema = z.object({
  name: z.string().min(1),
  firm: z.string().min(1),
  email: z.string().email(),
  title: z.string().optional(),
  linkedinUrl: z.string().url().optional().or(z.literal("")),
  website: z.string().url().optional().or(z.literal("")),
  stageFocus: z.array(z.string()).default([]),
  sectorFocus: z.array(z.string()).default([]),
  geoFocus: z.array(z.string()).default([]),
  checkSizeMinUsd: z.number().int().nullable().optional(),
  checkSizeMaxUsd: z.number().int().nullable().optional(),
  thesisKeywords: z.array(z.string()).default([]),
  portfolioCompanies: z.array(z.string()).default([]),
});

adminRouter.post("/investors", async (req, res) => {
  const parsed = createInvestorSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const v = parsed.data;

  try {
    const result = await pool.query(
      `INSERT INTO investors
        (name, firm, email, title, linkedin_url, website, stage_focus, sector_focus, geo_focus, check_size_min_usd, check_size_max_usd, thesis_keywords, portfolio_companies, needs_enrichment)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, false) RETURNING *`,
      [
        v.name,
        v.firm,
        v.email.toLowerCase(),
        v.title ?? null,
        v.linkedinUrl || null,
        v.website || null,
        v.stageFocus,
        v.sectorFocus,
        v.geoFocus,
        v.checkSizeMinUsd ?? null,
        v.checkSizeMaxUsd ?? null,
        v.thesisKeywords,
        v.portfolioCompanies,
      ]
    );
    res.status(201).json(toInvestorResponse(result.rows[0]));
  } catch (err: any) {
    if (err.code === "23505") return res.status(409).json({ error: "An investor with this email already exists." });
    throw err;
  }
});

const updateInvestorSchema = createInvestorSchema.partial();

/** Full edit — admin can correct/enrich any field, including turning off needs_enrichment once real data is added. */
adminRouter.patch("/investors/:id", async (req, res) => {
  const parsed = updateInvestorSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const v = parsed.data;

  const existing = await pool.query("SELECT * FROM investors WHERE id = $1", [req.params.id]);
  if (existing.rows.length === 0) return res.status(404).json({ error: "Investor not found." });
  const current = existing.rows[0];

  const hasEnrichmentDataNow =
    (v.stageFocus ?? current.stage_focus).length > 0 &&
    (v.sectorFocus ?? current.sector_focus).length > 0 &&
    (v.geoFocus ?? current.geo_focus).length > 0;

  const result = await pool.query(
    `UPDATE investors SET
      name = $1, firm = $2, email = $3, title = $4, linkedin_url = $5, website = $6,
      stage_focus = $7, sector_focus = $8, geo_focus = $9, check_size_min_usd = $10,
      check_size_max_usd = $11, thesis_keywords = $12, portfolio_companies = $13,
      needs_enrichment = $14
     WHERE id = $15 RETURNING *`,
    [
      v.name ?? current.name,
      v.firm ?? current.firm,
      (v.email ?? current.email).toLowerCase(),
      v.title ?? current.title,
      v.linkedinUrl || current.linkedin_url,
      v.website || current.website,
      v.stageFocus ?? current.stage_focus,
      v.sectorFocus ?? current.sector_focus,
      v.geoFocus ?? current.geo_focus,
      v.checkSizeMinUsd ?? current.check_size_min_usd,
      v.checkSizeMaxUsd ?? current.check_size_max_usd,
      v.thesisKeywords ?? current.thesis_keywords,
      v.portfolioCompanies ?? current.portfolio_companies,
      !hasEnrichmentDataNow,
      req.params.id,
    ]
  );
  res.json(toInvestorResponse(result.rows[0]));
});

adminRouter.delete("/investors/:id", async (req, res) => {
  const result = await pool.query("DELETE FROM investors WHERE id = $1 RETURNING id", [req.params.id]);
  if (result.rows.length === 0) return res.status(404).json({ error: "Investor not found." });
  res.json({ ok: true });
});

/** Bulk import — accepts either a JSON array, or a raw CSV file upload matching the
 * vc_contacts.csv format (first_name,last_name,email,title,company,source,...). */
adminRouter.post("/investors/bulk-import", upload.single("file"), async (req, res) => {
  let rows: any[] = [];

  if (req.file) {
    const content = req.file.buffer.toString("utf-8");
    const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return res.status(400).json({ error: "CSV file appears empty." });
    const headerLine = lines[0];
    if (!headerLine) return res.status(400).json({ error: "CSV file appears empty." });
    const headers = headerLine.split(",").map((h) => h.trim().toLowerCase());
    rows = lines.slice(1).map((line) => {
      const cells = line.split(",").map((c) => c.trim());
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => (obj[h] = cells[i] ?? ""));
      return {
        name: [obj.first_name, obj.last_name].filter(Boolean).join(" "),
        firm: obj.company,
        email: obj.email,
        title: obj.title || null,
        source: obj.source || null,
      };
    });
  } else if (Array.isArray(req.body.investors)) {
    rows = req.body.investors;
  } else {
    return res.status(400).json({ error: "Expected a CSV file upload (field 'file') or { investors: [...] } JSON body." });
  }

  let inserted = 0;
  let skipped = 0;
  for (const v of rows) {
    if (!v.name || !v.email || !v.firm) {
      skipped++;
      continue;
    }
    try {
      const result = await pool.query(
        `INSERT INTO investors
          (name, firm, email, title, source, stage_focus, sector_focus, geo_focus, check_size_min_usd, check_size_max_usd, thesis_keywords, portfolio_companies, is_verified, needs_enrichment)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (email) DO NOTHING RETURNING id`,
        [
          v.name,
          v.firm,
          String(v.email).toLowerCase(),
          v.title ?? null,
          v.source ?? null,
          v.stageFocus ?? [],
          v.sectorFocus ?? [],
          v.geoFocus ?? [],
          v.checkSizeMinUsd ?? null,
          v.checkSizeMaxUsd ?? null,
          v.thesisKeywords ?? [],
          v.portfolioCompanies ?? [],
          v.isVerified ?? false,
          !(v.stageFocus?.length && v.sectorFocus?.length && v.geoFocus?.length),
        ]
      );
      if (result.rows.length > 0) inserted++;
      else skipped++;
    } catch {
      skipped++;
    }
  }
  res.json({ inserted, skipped });
});

/** Admin manually verifies an investor email (or wires this up to a real verification API later). */
adminRouter.post("/investors/:id/verify", async (req, res) => {
  const result = await pool.query(
    "UPDATE investors SET is_verified = true, source_verified_at = now() WHERE id = $1 RETURNING *",
    [req.params.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: "Investor not found." });
  res.json(toInvestorResponse(result.rows[0]));
});

adminRouter.post("/investors/:id/unverify", async (req, res) => {
  const result = await pool.query("UPDATE investors SET is_verified = false WHERE id = $1 RETURNING *", [
    req.params.id,
  ]);
  if (result.rows.length === 0) return res.status(404).json({ error: "Investor not found." });
  res.json(toInvestorResponse(result.rows[0]));
});

// ---------- User/campaign oversight ----------

adminRouter.get("/users", async (_req, res) => {
  const result = await pool.query(
    `SELECT u.id, u.email, u.role, u.created_at, u.send_reputation_score, u.complaint_reported_at,
            COUNT(DISTINCT c.id)::int AS campaign_count
     FROM users u LEFT JOIN campaigns c ON c.user_id = u.id
     WHERE u.role = 'FOUNDER'
     GROUP BY u.id ORDER BY u.created_at DESC`
  );
  res.json(
    result.rows.map((u) => ({
      id: u.id,
      email: u.email,
      createdAt: u.created_at,
      sendReputationScore: u.send_reputation_score,
      complaintReportedAt: u.complaint_reported_at,
      campaignCount: u.campaign_count,
    }))
  );
});

/** Clears a spam-complaint flag after manual review, unblocking that user's sending. */
adminRouter.post("/users/:id/clear-complaint", async (req, res) => {
  const result = await pool.query(
    "UPDATE users SET complaint_reported_at = NULL, send_reputation_score = 1.0 WHERE id = $1 RETURNING id, email",
    [req.params.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: "User not found." });
  res.json({ ok: true, user: result.rows[0] });
});

adminRouter.get("/campaigns", async (_req, res) => {
  const result = await pool.query(
    `SELECT c.*, u.email AS founder_email, comp.name AS company_name
     FROM campaigns c
     JOIN users u ON u.id = c.user_id
     JOIN companies comp ON comp.id = c.company_id
     ORDER BY c.created_at DESC LIMIT 200`
  );
  res.json(
    result.rows.map((r) => ({
      id: r.id,
      founderEmail: r.founder_email,
      companyName: r.company_name,
      tier: r.tier,
      matchedInvestorCount: r.matched_investor_ids?.length ?? 0,
      status: r.status,
      createdAt: r.created_at,
    }))
  );
});

// ---------- Companies oversight ----------

adminRouter.get("/companies", async (_req, res) => {
  const result = await pool.query(
    `SELECT comp.*, u.email AS founder_email,
            (SELECT COUNT(*)::int FROM decks d WHERE d.company_id = comp.id) AS deck_count,
            (SELECT COUNT(*)::int FROM campaigns c WHERE c.company_id = comp.id) AS campaign_count
     FROM companies comp JOIN users u ON u.id = comp.user_id
     ORDER BY comp.created_at DESC LIMIT 200`
  );
  res.json(
    result.rows.map((r) => ({
      id: r.id,
      name: r.name,
      oneLiner: r.one_liner,
      founderEmail: r.founder_email,
      stage: r.stage,
      askAmountUsd: r.ask_amount_usd,
      deckCount: r.deck_count,
      campaignCount: r.campaign_count,
      createdAt: r.created_at,
    }))
  );
});

// ---------- Payments / invoices ----------

adminRouter.get("/payments", async (_req, res) => {
  const result = await pool.query(
    `SELECT i.*, u.email AS founder_email
     FROM invoices i JOIN users u ON u.id = i.user_id
     ORDER BY i.created_at DESC LIMIT 200`
  );
  res.json(
    result.rows.map((r) => ({
      id: r.id,
      founderEmail: r.founder_email,
      tier: r.tier,
      amountInr: r.amount_inr,
      status: r.status,
      razorpayOrderId: r.razorpay_order_id,
      razorpayPaymentId: r.razorpay_payment_id,
      createdAt: r.created_at,
    }))
  );
});

// ---------- Support ----------

adminRouter.get("/support", async (_req, res) => {
  const result = await pool.query("SELECT * FROM support_messages ORDER BY created_at DESC LIMIT 200");
  res.json(
    result.rows.map((r) => ({
      id: r.id,
      email: r.email,
      subject: r.subject,
      message: r.message,
      status: r.status,
      createdAt: r.created_at,
    }))
  );
});

adminRouter.post("/support/:id/resolve", async (req, res) => {
  const result = await pool.query(
    "UPDATE support_messages SET status = 'RESOLVED' WHERE id = $1 RETURNING id",
    [req.params.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: "Message not found." });
  res.json({ ok: true });
});

adminRouter.post("/gmail/check-replies", async (_req, res) => {
  const results = await checkGmailRepliesForAllUsers();
  const totalProcessed = results.reduce((sum, r) => sum + r.processed, 0);
  const totalReplied = results.reduce((sum, r) => sum + r.replied, 0);
  const allErrors = results.flatMap((r) => r.errors);
  res.json({ usersChecked: results.length, totalProcessed, totalReplied, errors: allErrors });
});

function toInvestorResponse(row: any) {
  return {
    id: row.id,
    name: row.name,
    firm: row.firm,
    email: row.email,
    title: row.title,
    linkedinUrl: row.linkedin_url,
    website: row.website,
    source: row.source,
    stageFocus: row.stage_focus,
    sectorFocus: row.sector_focus,
    geoFocus: row.geo_focus,
    checkSizeMinUsd: row.check_size_min_usd,
    checkSizeMaxUsd: row.check_size_max_usd,
    thesisKeywords: row.thesis_keywords,
    portfolioCompanies: row.portfolio_companies,
    isVerified: row.is_verified,
    needsEnrichment: row.needs_enrichment,
    lastKnownActiveAt: row.last_known_active_at,
    createdAt: row.created_at,
  };
}
