import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../lib/auth";
import { pool } from "../lib/db";

export const profileRouter = Router();
profileRouter.use(requireAuth);

profileRouter.get("/me", async (req, res) => {
  const result = await pool.query(
    `SELECT id, email, name, role, gmail_connected_at, connected_gmail_address, google_refresh_token,
            send_reputation_score, account_age_days, complaint_reported_at, created_at
     FROM users WHERE id = $1`,
    [req.auth!.userId]
  );
  const u = result.rows[0];
  if (!u) return res.status(404).json({ error: "User not found." });
  res.json({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    gmailConnected: !!(u.gmail_connected_at || u.google_refresh_token),
    connectedGmailAddress: u.connected_gmail_address,
    gmailConnectedAt: u.gmail_connected_at,
    sendReputationScore: u.send_reputation_score,
    accountAgeDays: u.account_age_days,
    complaintReportedAt: u.complaint_reported_at,
    createdAt: u.created_at,
  });
});

const updateProfileSchema = z.object({ name: z.string().min(1).max(100) });

profileRouter.patch("/me", async (req, res) => {
  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  await pool.query("UPDATE users SET name = $1 WHERE id = $2", [parsed.data.name, req.auth!.userId]);
  res.json({ ok: true });
});

profileRouter.post("/disconnect-gmail", async (req, res) => {
  const { disconnectGmail } = await import("./googleAuth");
  await disconnectGmail(req.auth!.userId);
  res.json({ ok: true });
});
