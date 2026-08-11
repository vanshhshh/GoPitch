import { Router } from "express";
import { google } from "googleapis";
import { pool } from "../lib/db";
import { encryptToken, decryptToken } from "../lib/tokenEncryption";
import { verifyToken, signToken } from "../lib/auth";

export const googleAuthRouter = Router();

function getOAuthClient(redirectUri?: string) {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri || process.env.GOOGLE_REDIRECT_URI || "http://localhost:4000/auth/google/callback"
  );
}

const GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
const USERINFO_EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email";
const GOOGLE_SIGNIN_SCOPES = ["openid", "email", "profile"];
const GMAIL_LEGACY_SCOPE = "https://www.googleapis.com/auth/gmail.send";

function getGmailScope(): string {
  const mode = (process.env.GMAIL_OAUTH_SCOPE || "modify").toLowerCase();
  return mode === "send" ? GMAIL_LEGACY_SCOPE : GMAIL_MODIFY_SCOPE;
}

const oauthStateStore = new Map<string, number>();

function cleanStateStore() {
  const now = Date.now();
  const maxAge = 10 * 60 * 1000; // 10 minutes
  for (const [key, ts] of oauthStateStore.entries()) {
    if (now - ts > maxAge) oauthStateStore.delete(key);
  }
}

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
    verifyToken(token);
  } catch {
    return res.status(401).json({ error: "Invalid or expired session — log in again before connecting Gmail." });
  }

  const client = getOAuthClient(process.env.GOOGLE_REDIRECT_URI);
  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [getGmailScope(), USERINFO_EMAIL_SCOPE],
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
    const client = getOAuthClient(process.env.GOOGLE_REDIRECT_URI);
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

    const grantedScopes = Array.isArray(tokens.scope) ? tokens.scope.join(" ") : tokens.scope || null;

    const update = await pool.query(
      `UPDATE users SET
        google_refresh_token = $1,
        google_access_token = $2,
        google_token_expiry = $3,
        gmail_connected_at = now(),
        connected_gmail_address = $4,
        account_age_days = 0,
        gmail_granted_scopes = $5
       WHERE id = $6`,
      [
        encryptedRefreshToken,
        tokens.access_token ?? null,
        tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        profile.email,
        grantedScopes,
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

/**
 * Google Sign-In flow — separate from Gmail connection.
 * Uses OpenID Connect scopes only. Never requests Gmail permissions.
 */
googleAuthRouter.get("/auth/google/signin", (req, res) => {
  const signinRedirectUri = process.env.GOOGLE_SIGNIN_REDIRECT_URI || `${process.env.GOOGLE_REDIRECT_URI?.replace('/auth/google/callback', '/auth/google/signin/callback') || 'http://localhost:4000/auth/google/signin/callback'}`;
  const client = getOAuthClient(signinRedirectUri);
  const state = Buffer.from(`${Date.now()}-${Math.random()}`).toString("base64url");
  cleanStateStore();
  oauthStateStore.set(state, Date.now());

  const url = client.generateAuthUrl({
    access_type: "online",
    prompt: "select_account",
    scope: GOOGLE_SIGNIN_SCOPES,
    state,
  });

  res.redirect(url);
});

googleAuthRouter.get("/auth/google/signin/callback", async (req, res) => {
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";

  if (!code || !state) {
    return res.redirect(`${frontendUrl}/login?google_error=access_denied`);
  }

  cleanStateStore();
  if (!oauthStateStore.has(state)) {
    return res.redirect(`${frontendUrl}/login?google_error=invalid_state`);
  }
  oauthStateStore.delete(state);

  try {
    const signinRedirectUri = process.env.GOOGLE_SIGNIN_REDIRECT_URI || `${process.env.GOOGLE_REDIRECT_URI?.replace('/auth/google/callback', '/auth/google/signin/callback') || 'http://localhost:4000/auth/google/signin/callback'}`;
    const client = getOAuthClient(signinRedirectUri);
    const { tokens } = await client.getToken(code);
    if (!tokens.id_token) {
      return res.redirect(`${frontendUrl}/login?google_error=no_id_token`);
    }

    client.setCredentials(tokens);
    const oauth2 = google.oauth2({ auth: client, version: "v2" });
    const { data: profile } = await oauth2.userinfo.get();

    const googleSub = profile.id;
    const googleEmail = profile.email?.toLowerCase();
    const googleName = profile.name;

    if (!googleEmail || !googleSub) {
      return res.redirect(`${frontendUrl}/login?google_error=missing_profile`);
    }

    let result = await pool.query("SELECT id, email, name, role FROM users WHERE google_sub = $1", [googleSub]);
    let user = result.rows[0];

    if (!user) {
      result = await pool.query("SELECT id, email, name, role FROM users WHERE email = $1", [googleEmail]);
      user = result.rows[0];

      if (user) {
        await pool.query(
          `UPDATE users SET google_sub = $1, google_email = $2 WHERE id = $3`,
          [googleSub, googleEmail, user.id]
        );
      } else {
        result = await pool.query(
          `INSERT INTO users (email, name, role, google_sub, google_email) VALUES ($1, $2, 'FOUNDER', $3, $4) RETURNING id, email, name, role`,
          [googleEmail, googleName, googleSub, googleEmail]
        );
        user = result.rows[0];
      }
    }

    const token = signToken({ userId: user.id, role: user.role });
    res.redirect(`${frontendUrl}/login?google_token=${token}`);
  } catch (err) {
    console.error("Google Sign-In callback failed:", err);
    res.redirect(`${frontendUrl}/login?google_error=auth_failed`);
  }
});

/** Lets a founder disconnect Gmail — clears stored tokens, does not revoke at Google's end */
export async function disconnectGmail(userId: string) {
  await pool.query(
    `UPDATE users SET google_refresh_token = NULL, google_access_token = NULL,
      google_token_expiry = NULL, gmail_connected_at = NULL, connected_gmail_address = NULL,
      gmail_granted_scopes = NULL
     WHERE id = $1`,
    [userId]
  );
}

export function userHasGmailModifyScope(grantedScopes: string | null | undefined): boolean {
  if (!grantedScopes) return false;
  const scopes = grantedScopes.split(" ").filter(Boolean);
  return scopes.includes(GMAIL_MODIFY_SCOPE);
}

export function isInsufficientGmailScopeError(err: any): boolean {
  if (!err) return false;
  const message = err?.message || err?.errors?.[0]?.message || "";
  return message.includes("insufficient") || message.includes("scope") || message.includes("403");
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
