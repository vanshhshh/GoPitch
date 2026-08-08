import { Router } from "express";
import { z } from "zod";
import { pool } from "../lib/db";
import { requireAuth } from "../lib/auth";

export const companyRouter = Router();
companyRouter.use(requireAuth);

const STAGES = ["IDEA", "PRE_SEED", "SEED", "SERIES_A", "SERIES_B_PLUS"] as const;

const createCompanySchema = z.object({
  name: z.string().min(1),
  oneLiner: z.string().min(1).max(200),
  problem: z.string().min(1),
  solution: z.string().min(1),
  stage: z.enum(STAGES),
  sector: z.array(z.string()).min(1),
  geography: z.array(z.string()).min(1),
  askAmountUsd: z.number().int().positive(),
  traction: z.string().optional(),
  founderBackground: z.string().optional(),
  screenshotUrls: z.array(z.string()).optional(),
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
