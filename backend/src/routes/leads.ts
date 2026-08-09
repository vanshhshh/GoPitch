import { Router } from "express";
import { pool } from "../lib/db";

export const leadsRouter = Router();

leadsRouter.post("/", async (req, res) => {
  const { name, phone, email, reason } = req.body ?? {};
  if (!name || !email || !reason) {
    return res.status(400).json({ error: "Name, email and reason are required." });
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS leads (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT NOT NULL,
      reason TEXT NOT NULL,
      tier TEXT NOT NULL DEFAULT 'ENTERPRISE',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await pool.query(
    `INSERT INTO leads (name, phone, email, reason, tier) VALUES ($1, $2, $3, $4, $5)`,
    [name, phone || null, email, reason, "ENTERPRISE"]
  );

  res.status(201).json({ ok: true });
});
