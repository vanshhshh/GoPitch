import { Router } from "express";
import { z } from "zod";
import { pool } from "../lib/db";
import { requireAuth } from "../lib/auth";

export const companyRouter = Router();
companyRouter.use(requireAuth);

const STAGES = ["IDEA", "PRE_SEED", "SEED", "SERIES_A", "SERIES_B_PLUS"] as const;

const tagList = (label: string) =>
  z
    .array(z.string().trim().min(1).max(60))
    .min(1, `Add at least one ${label}.`)
    .max(20)
    .transform((tags) => [...new Set(tags)]);

const createCompanySchema = z.object({
  name: z.string().trim().min(1, "Company name is required.").max(120),
  oneLiner: z.string().trim().min(1, "One-line description is required.").max(200),
  problem: z.string().trim().min(1, "Describe the problem you solve.").max(4000),
  solution: z.string().trim().min(1, "Describe your solution.").max(4000),
  stage: z.enum(STAGES),
  sector: tagList("sector"),
  geography: tagList("geography"),
  askAmountUsd: z.number().int().positive("Raise amount must be greater than zero.").max(2_000_000_000),
  traction: z.string().trim().max(4000).optional(),
  founderBackground: z.string().trim().max(4000).optional(),
  screenshotUrls: z.array(z.string().url().max(2000)).max(20).optional(),
});

companyRouter.post("/", async (req, res) => {
  const parsed = createCompanySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input." });
  }
  const c = parsed.data;
  const userId = req.auth!.userId;

  const result = await pool.query(
    `INSERT INTO companies
      (user_id, name, one_liner, problem, solution, stage, sector, geography, ask_amount_usd, traction, founder_background, screenshot_urls)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      userId,
      c.name,
      c.oneLiner,
      c.problem,
      c.solution,
      c.stage,
      c.sector,
      c.geography,
      c.askAmountUsd,
      c.traction ?? null,
      c.founderBackground ?? null,
      c.screenshotUrls ?? [],
    ]
  );
  res.status(201).json(toCompanyResponse(result.rows[0]));
});

companyRouter.get("/", async (req, res) => {
  const userId = req.auth!.userId;
  const result = await pool.query("SELECT * FROM companies WHERE user_id = $1 ORDER BY created_at DESC", [userId]);
  res.json(result.rows.map(toCompanyResponse));
});

companyRouter.get("/:id", async (req, res) => {
  const userId = req.auth!.userId;
  const result = await pool.query("SELECT * FROM companies WHERE id = $1 AND user_id = $2", [req.params.id, userId]);
  if (result.rows.length === 0) return res.status(404).json({ error: "Company not found." });
  res.json(toCompanyResponse(result.rows[0]));
});

/**
 * Founder edits their company profile. Matching reads these fields live, so the next
 * preview/campaign reflects the change. If the sectors change, LLM-extracted keywords
 * from an older deck no longer describe the company, so they're cleared and matching
 * falls back to the new sector tags until a deck is regenerated.
 */
companyRouter.patch("/:id", async (req, res) => {
  const parsed = createCompanySchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input." });
  const c = parsed.data;
  const userId = req.auth!.userId;

  const existing = (await pool.query("SELECT * FROM companies WHERE id = $1 AND user_id = $2", [req.params.id, userId])).rows[0];
  if (!existing) return res.status(404).json({ error: "Company not found." });

  const sectorChanged = c.sector !== undefined && JSON.stringify([...c.sector].sort()) !== JSON.stringify([...existing.sector].sort());
  const result = await pool.query(
    `UPDATE companies SET name = $1, one_liner = $2, problem = $3, solution = $4, stage = $5, sector = $6, geography = $7,
       ask_amount_usd = $8, traction = $9, founder_background = $10,
       extracted_keywords = CASE WHEN $11 THEN '{}'::text[] ELSE extracted_keywords END
     WHERE id = $12 AND user_id = $13 RETURNING *`,
    [
      c.name ?? existing.name,
      c.oneLiner ?? existing.one_liner,
      c.problem ?? existing.problem,
      c.solution ?? existing.solution,
      c.stage ?? existing.stage,
      c.sector ?? existing.sector,
      c.geography ?? existing.geography,
      c.askAmountUsd ?? existing.ask_amount_usd,
      c.traction !== undefined ? c.traction || null : existing.traction,
      c.founderBackground !== undefined ? c.founderBackground || null : existing.founder_background,
      sectorChanged,
      req.params.id,
      userId,
    ]
  );
  res.json(toCompanyResponse(result.rows[0]));
});

function toCompanyResponse(row: any) {
  return {
    id: row.id,
    name: row.name,
    oneLiner: row.one_liner,
    problem: row.problem,
    solution: row.solution,
    stage: row.stage,
    sector: row.sector,
    geography: row.geography,
    askAmountUsd: row.ask_amount_usd,
    traction: row.traction,
    founderBackground: row.founder_background,
    screenshotUrls: row.screenshot_urls,
    extractedKeywords: row.extracted_keywords,
    createdAt: row.created_at,
  };
}
