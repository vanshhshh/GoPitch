import { Router } from "express";
import { pool } from "../lib/db";

export const leadsRouter = Router();

leadsRouter.post("/", async (req, res) => {
  const { name, phone, email, company, website, teamSize, outreachVolume, message, userId } = req.body ?? {};
  if (!name || !email || !message) {
    return res.status(400).json({ error: "Name, email and message are required." });
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id TEXT REFERENCES users(id),
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT NOT NULL,
      company TEXT,
      website TEXT,
      team_size TEXT,
      outreach_volume TEXT,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'NEW',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await pool.query(
    `INSERT INTO leads (user_id, name, phone, email, company, website, team_size, outreach_volume, message) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [userId || null, name, phone || null, email, company || null, website || null, teamSize || null, outreachVolume || null, message]
  );

  res.status(201).json({ ok: true });
});
