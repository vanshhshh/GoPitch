import { Router } from "express";
import { google } from "googleapis";
import { pool } from "../lib/db";
import { encryptToken, decryptToken } from "../lib/tokenEncryption";
import { verifyToken } from "../lib/auth";

export const googleAuthRouter = Router();

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const USERINFO_EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email";

/**
 * Step 1: redirect the founder to Google's consent screen. The JWT is passed as
 * `state` (not a cookie) because this is a full-page redirect flow, not an XHR — Google
 * round-trips `state` back to the callback unmodified, which is how we know which
 * platform user to attach the resulting tokens to after the redirect chain.
 */
googleAuthRouter.get("/auth/google/init", (req, res) => {
  const token = req.query.token as string | undefined;
  if (!token) return res.status(400).json({ error: "Missing token query param." });

  try {
    verifyToken(token); // fail fast with a clear error rather than discovering it at the callback
  } catch {
    return res.status(401).json({ error: "Invalid or expired session — log in again before connecting Gmail." });
  }

  const client = getOAuthClient();
  const url = client.generateAuthUrl({
    access_type: "offline", // required to receive a refresh_token, not just a short-lived access_token
    prompt: "consent", // forces Google to re-issue a refresh_token even on repeat connects
    scope: [GMAIL_SEND_SCOPE, USERINFO_EMAIL_SCOPE],
    state: token,
  });

  res.redirect(url);
});

/** Step 2: Google redirects back here with an authorization code + our state (the JWT). */
googleAuthRouter.get("/auth/google/callback", async (req, res) => {
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";

  if (!code || !state) {
    return res.redirect(`${frontendUrl}/dashboard?gmail_error=missing_code`);
  }

  let auth;
  try {
    auth = verifyToken(state);
  } catch {
    return res.redirect(`${frontendUrl}/login?gmail_error=session_expired`);
  }

  try {
    const client = getOAuthClient();
    const { tokens } = await client.getToken(code);

    client.setCredentials(tokens);
    const oauth2 = google.oauth2({ auth: client, version: "v2" });
    const { data: profile } = await oauth2.userinfo.get();

    const existing = await pool.query("SELECT google_refresh_token FROM users WHERE id = $1", [auth.userId]);
    const existingRefreshToken = existing.rows[0]?.google_refresh_token as string | null | undefined;
    const encryptedRefreshToken = tokens.refresh_token ? encryptToken(tokens.refresh_token) : existingRefreshToken;

    if (!encryptedRefreshToken) {
      return res.redirect(`${frontendUrl}/dashboard/settings?gmail_error=no_refresh_token`);
    }

    const update = await pool.query(
      `UPDATE users SET
        google_refresh_token = $1,
        google_access_token = $2,
        google_token_expiry = $3,
        gmail_connected_at = now(),
        connected_gmail_address = $4,
        account_age_days = 0
       WHERE id = $5`,
      [
        encryptedRefreshToken,
        tokens.access_token ?? null,
        tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        profile.email,
        auth.userId,
      ]
    );
    if (update.rowCount === 0) {
      return res.redirect(`${frontendUrl}/login?gmail_error=session_expired`);
    }

    res.redirect(`${frontendUrl}/dashboard/settings?gmail_connected=true`);
  } catch (err) {
    console.error("Google OAuth callback failed:", err);
    res.redirect(`${frontendUrl}/dashboard?gmail_error=exchange_failed`);
  }
});

/** Lets a founder disconnect Gmail — clears stored tokens, does not revoke at Google's end
 * (that's a separate explicit action since revoking also affects other apps using the same grant). */
export async function disconnectGmail(userId: string) {
  await pool.query(
    `UPDATE users SET google_refresh_token = NULL, google_access_token = NULL,
      google_token_expiry = NULL, gmail_connected_at = NULL, connected_gmail_address = NULL
     WHERE id = $1`,
    [userId]
  );
}

/**
 * Returns an authenticated Gmail API client for a user, refreshing the access token from
 * the encrypted refresh token as needed. Used by the real send path in routes/sends.ts.
 */
export async function getGmailClientForUser(userId: string) {
  const result = await pool.query("SELECT google_refresh_token FROM users WHERE id = $1", [userId]);
  const encryptedRefreshToken = result.rows[0]?.google_refresh_token;
  if (!encryptedRefreshToken) return null;

  const refreshToken = decryptToken(encryptedRefreshToken);
  const client = getOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });

  return google.gmail({ version: "v1", auth: client });
}

