import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../lib/auth";
import { pool } from "../lib/db";
import { buildGmailConsentUrl, confirmGmailConnection, disconnectGmail, userHasReplyTrackingScope } from "./googleAuth";

export const profileRouter = Router();
profileRouter.use(requireAuth);

profileRouter.get("/me", async (req, res) => {
  const result = await pool.query(
    `SELECT id, email, name, role, gmail_connected_at, connected_gmail_address, google_refresh_token,
            send_reputation_score, account_age_days, complaint_reported_at, created_at, gmail_granted_scopes
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
    // Connected means we hold a usable credential — not merely that a timestamp exists.
    gmailConnected: !!u.google_refresh_token,
    replyTrackingEnabled: userHasReplyTrackingScope(u.gmail_granted_scopes),
    connectedGmailAddress: u.connected_gmail_address,
    gmailConnectedAt: u.gmail_connected_at,
    sendReputationScore: u.send_reputation_score,
    accountAgeDays: u.account_age_days,
    complaintReportedAt: u.complaint_reported_at,
    createdAt: u.created_at,
    gmailGrantedScopes: u.gmail_granted_scopes,
  });
});

const updateProfileSchema = z.object({ name: z.string().trim().min(1, "Name is required.").max(100) });

profileRouter.patch("/me", async (req, res) => {
  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  await pool.query("UPDATE users SET name = $1 WHERE id = $2", [parsed.data.name, req.auth!.userId]);
  res.json({ ok: true });
});

/** Starts Gmail connection. Authenticated via the Authorization header — no token in any URL. */
profileRouter.post("/gmail/connect", async (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(503).json({ error: "Gmail connection isn't configured on this server yet." });
  }
  res.json({ url: await buildGmailConsentUrl(req.auth!.userId) });
});

const CONFIRM_ERRORS: Record<string, { status: number; error: string }> = {
  invalid_or_expired: { status: 410, error: "This Gmail connection attempt expired. Please connect again." },
  account_mismatch: {
    status: 403,
    error: "This Gmail authorization was started from a different GoPitch account. Sign in to that account, or connect again from here.",
  },
  no_refresh_token: {
    status: 400,
    error: "Google didn't return offline access. Remove GoPitch from your Google account's third-party access, then connect again.",
  },
};

/** Second half of Gmail connection: attaches the parked tokens to the logged-in account. */
profileRouter.post("/gmail/confirm", async (req, res) => {
  const nonce = typeof req.body?.nonce === "string" ? req.body.nonce : "";
  const result = await confirmGmailConnection(nonce, req.auth!.userId);
  if (!result.ok) {
    const { status, error } = CONFIRM_ERRORS[result.reason]!;
    return res.status(status).json({ error, reason: result.reason });
  }
  res.json({ ok: true, connectedGmailAddress: result.gmailAddress });
});

profileRouter.post("/disconnect-gmail", async (req, res) => {
  await disconnectGmail(req.auth!.userId);
  res.json({ ok: true });
});
