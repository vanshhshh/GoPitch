import { Router, Request } from "express";
import * as crypto from "crypto";
import { google } from "googleapis";
import { pool, Queryable } from "../lib/db";
import { encryptToken, decryptToken } from "../lib/tokenEncryption";
import { signToken } from "../lib/auth";

/**
 * Two completely separate Google OAuth flows live here:
 *
 *  1. Google Sign-In (identity only: openid/email/profile) — /auth/google/signin[/callback]
 *  2. Gmail connection (send + reply tracking) — started by an authenticated API call,
 *     returns to /auth/google/callback
 *
 * Each flow's `state` is a random value stored server-side in oauth_states with a
 * `purpose`, and each callback only accepts its own purpose — a Sign-In authorization
 * response can never be processed by the Gmail callback or vice versa. No JWT ever
 * appears in a URL (it used to be passed as ?token= and as `state`, leaking it to browser
 * history, proxy logs and Google).
 */
export const googleAuthRouter = Router();

const FRONTEND_URL = () => process.env.FRONTEND_URL || "http://localhost:3000";
const STATE_TTL_MS = 10 * 60 * 1000;
const SIGNIN_CODE_TTL_MS = 2 * 60 * 1000;
const SIGNIN_STATE_COOKIE = "gp_signin_state";

function getOAuthClient(redirectUri?: string) {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri || process.env.GOOGLE_REDIRECT_URI || "http://localhost:4000/auth/google/callback"
  );
}

function signinRedirectUri(): string {
  return (
    process.env.GOOGLE_SIGNIN_REDIRECT_URI ||
    process.env.GOOGLE_REDIRECT_URI?.replace("/auth/google/callback", "/auth/google/signin/callback") ||
    "http://localhost:4000/auth/google/signin/callback"
  );
}

const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const GMAIL_METADATA_SCOPE = "https://www.googleapis.com/auth/gmail.metadata";
const GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
const USERINFO_EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email";
const GOOGLE_SIGNIN_SCOPES = ["openid", "email", "profile"];

/**
 * Least privilege: sending needs gmail.send; reply/bounce detection only reads thread
 * headers (threads.get format=metadata), which gmail.metadata covers. Nothing in GoPitch
 * modifies, labels or deletes mail, so gmail.modify is only requested if explicitly
 * configured for backwards compatibility (GMAIL_OAUTH_SCOPE=modify).
 */
export function getGmailScopes(mode = (process.env.GMAIL_OAUTH_SCOPE || "metadata").toLowerCase()): string[] {
  if (mode === "send") return [GMAIL_SEND_SCOPE, USERINFO_EMAIL_SCOPE];
  if (mode === "modify") return [GMAIL_MODIFY_SCOPE, USERINFO_EMAIL_SCOPE];
  return [GMAIL_SEND_SCOPE, GMAIL_METADATA_SCOPE, USERINFO_EMAIL_SCOPE];
}

// ---------- server-side OAuth state ----------

type StatePurpose = "gmail_connect" | "gmail_confirm" | "signin" | "signin_code";

function randomState(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export async function createOAuthState(
  purpose: StatePurpose,
  userId: string | null,
  ttlMs: number,
  payload?: unknown,
  db: Queryable = pool
): Promise<string> {
  const state = randomState();
  await db.query("DELETE FROM oauth_states WHERE expires_at < now()");
  await db.query(
    "INSERT INTO oauth_states (state, purpose, user_id, payload, expires_at) VALUES ($1, $2, $3, $4, now() + ($5 || ' milliseconds')::interval)",
    [state, purpose, userId, payload === undefined ? null : encryptToken(JSON.stringify(payload)), String(ttlMs)]
  );
  return state;
}

/** Single-use: the row is deleted as it is read, so a replayed state/code is rejected. */
export async function consumeOAuthState<T = unknown>(
  state: string | undefined,
  purpose: StatePurpose,
  db: Queryable = pool
): Promise<{ userId: string | null; payload: T | null } | null> {
  if (!state || state.length > 200) return null;
  const result = await db.query(
    "DELETE FROM oauth_states WHERE state = $1 AND purpose = $2 AND expires_at > now() RETURNING user_id, payload",
    [state, purpose]
  );
  const row = result.rows[0];
  if (!row) return null;
  return { userId: row.user_id, payload: row.payload ? (JSON.parse(decryptToken(row.payload)) as T) : null };
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

// ---------- Gmail connection ----------

/** Called by the authenticated POST /api/profile/gmail/connect. Returns Google's consent URL. */
export async function buildGmailConsentUrl(userId: string): Promise<string> {
  const state = await createOAuthState("gmail_connect", userId, STATE_TTL_MS);
  return getOAuthClient(process.env.GOOGLE_REDIRECT_URI).generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: getGmailScopes(),
    state,
  });
}

/** Old entry point that took ?token=<JWT>. Kept only so stale links land somewhere sensible. */
googleAuthRouter.get("/auth/google/init", (_req, res) => {
  res.redirect(`${FRONTEND_URL()}/dashboard/settings?gmail_error=restart`);
});

interface PendingGmailConnection {
  encryptedRefreshToken: string | null;
  gmailAddress: string;
  grantedScopes: string | null;
}

/**
 * Google redirects here after Gmail consent. The tokens are NOT attached to an account
 * yet: they're parked (encrypted) under a one-time confirmation nonce and the browser is
 * sent back to the app, which must confirm with the logged-in session's Authorization
 * header. If someone tricks a victim into completing a consent URL generated for the
 * attacker's account, the victim's browser confirms with the victim's session (or none),
 * the user ids don't match, and the victim's Gmail is never attached to the attacker.
 */
googleAuthRouter.get("/auth/google/callback", async (req, res) => {
  const frontendUrl = FRONTEND_URL();
  if (req.query.error) return res.redirect(`${frontendUrl}/dashboard/settings?gmail_error=access_denied`);

  const code = req.query.code as string | undefined;
  const pending = await consumeOAuthState(req.query.state as string | undefined, "gmail_connect");
  if (!code || !pending?.userId) return res.redirect(`${frontendUrl}/dashboard/settings?gmail_error=invalid_state`);

  try {
    const client = getOAuthClient(process.env.GOOGLE_REDIRECT_URI);
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);
    const { data: profile } = await google.oauth2({ auth: client, version: "v2" }).userinfo.get();
    if (!profile.email) return res.redirect(`${frontendUrl}/dashboard/settings?gmail_error=missing_profile`);

    const grantedScopes = Array.isArray(tokens.scope) ? tokens.scope.join(" ") : tokens.scope || null;
    if (!grantedScopes || !/gmail\.(send|modify)/.test(grantedScopes)) {
      // The user unticked the send permission on Google's consent screen.
      return res.redirect(`${frontendUrl}/dashboard/settings?gmail_error=send_permission_missing`);
    }

    const confirmNonce = await createOAuthState("gmail_confirm", pending.userId, STATE_TTL_MS, {
      encryptedRefreshToken: tokens.refresh_token ? encryptToken(tokens.refresh_token) : null,
      gmailAddress: profile.email.toLowerCase(),
      grantedScopes,
    } satisfies PendingGmailConnection);
    res.redirect(`${frontendUrl}/dashboard/settings?gmail_confirm=${encodeURIComponent(confirmNonce)}`);
  } catch (err) {
    console.error("Google OAuth callback failed:", (err as Error).message);
    res.redirect(`${frontendUrl}/dashboard/settings?gmail_error=exchange_failed`);
  }
});

export type GmailConfirmResult =
  | { ok: true; gmailAddress: string }
  | { ok: false; reason: "invalid_or_expired" | "account_mismatch" | "no_refresh_token" };

export async function confirmGmailConnection(nonce: string, userId: string): Promise<GmailConfirmResult> {
  const pending = await consumeOAuthState<PendingGmailConnection>(nonce, "gmail_confirm");
  if (!pending?.payload) return { ok: false, reason: "invalid_or_expired" };
  if (pending.userId !== userId) return { ok: false, reason: "account_mismatch" };

  const { encryptedRefreshToken, gmailAddress, grantedScopes } = pending.payload;
  const existing = (await pool.query("SELECT google_refresh_token, connected_gmail_address FROM users WHERE id = $1", [userId])).rows[0];
  if (!existing) return { ok: false, reason: "invalid_or_expired" };

  // Google omits refresh_token on re-consent for an already-granted client; reuse the
  // stored one only if it belongs to the same Gmail address.
  const sameAddress = existing.connected_gmail_address?.toLowerCase() === gmailAddress;
  const refreshToken = encryptedRefreshToken ?? (sameAddress ? existing.google_refresh_token : null);
  if (!refreshToken) return { ok: false, reason: "no_refresh_token" };

  // Reconnecting the same address keeps its warm-up age; a different address starts warm-up over.
  await pool.query(
    `UPDATE users SET
       google_refresh_token = $1,
       google_access_token = NULL,
       google_token_expiry = NULL,
       gmail_connected_at = CASE WHEN $4 AND gmail_connected_at IS NOT NULL THEN gmail_connected_at ELSE now() END,
       connected_gmail_address = $2,
       account_age_days = 0,
       gmail_granted_scopes = $3,
       gmail_watch_cursor = CASE WHEN $4 THEN gmail_watch_cursor ELSE NULL END
     WHERE id = $5`,
    [refreshToken, gmailAddress, grantedScopes, sameAddress, userId]
  );
  return { ok: true, gmailAddress };
}

/** Clears stored Gmail credentials and (best effort) revokes the grant at Google. */
export async function disconnectGmail(userId: string, options: { revoke?: boolean } = {}) {
  if (options.revoke !== false) {
    const row = (await pool.query("SELECT google_refresh_token FROM users WHERE id = $1", [userId])).rows[0];
    if (row?.google_refresh_token) {
      try {
        await getOAuthClient().revokeToken(decryptToken(row.google_refresh_token));
      } catch (err) {
        // Already revoked or unreadable — clearing our copy below is what matters.
        console.warn("Gmail token revoke failed:", (err as Error).message);
      }
    }
  }
  await pool.query(
    `UPDATE users SET google_refresh_token = NULL, google_access_token = NULL,
      google_token_expiry = NULL, gmail_connected_at = NULL, connected_gmail_address = NULL,
      gmail_granted_scopes = NULL, gmail_watch_cursor = NULL
     WHERE id = $1`,
    [userId]
  );
}

/** True when the grant lets the watcher read thread headers for reply/bounce detection. */
export function userHasReplyTrackingScope(grantedScopes: string | null | undefined): boolean {
  if (!grantedScopes) return false;
  const scopes = grantedScopes.split(" ").filter(Boolean);
  return [GMAIL_METADATA_SCOPE, GMAIL_MODIFY_SCOPE, "https://www.googleapis.com/auth/gmail.readonly"].some((s) => scopes.includes(s));
}

/** @deprecated kept for callers/tests written against the old modify-only check. */
export const userHasGmailModifyScope = userHasReplyTrackingScope;

export function isInsufficientGmailScopeError(err: any): boolean {
  if (!err) return false;
  const message = err?.message || err?.errors?.[0]?.message || "";
  return message.includes("insufficient") || message.includes("scope") || message.includes("403");
}

/**
 * Returns an authenticated Gmail API client for a user, refreshing the access token from
 * the encrypted refresh token as needed. Always scoped to the given user's own token.
 */
export async function getGmailClientForUser(userId: string) {
  const result = await pool.query("SELECT google_refresh_token FROM users WHERE id = $1", [userId]);
  const encryptedRefreshToken = result.rows[0]?.google_refresh_token;
  if (!encryptedRefreshToken) return null;

  const client = getOAuthClient();
  client.setCredentials({ refresh_token: decryptToken(encryptedRefreshToken) });
  return google.gmail({ version: "v1", auth: client });
}

// ---------- Google Sign-In ----------

googleAuthRouter.get("/auth/google/signin", async (_req, res) => {
  const state = await createOAuthState("signin", null, STATE_TTL_MS);
  // Binds the flow to this browser: the callback requires the same value back in a cookie,
  // so an attacker can't log a victim into the attacker's account with a pre-made link.
  res.cookie(SIGNIN_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: STATE_TTL_MS,
    path: "/auth/google",
  });
  const url = getOAuthClient(signinRedirectUri()).generateAuthUrl({
    access_type: "online",
    prompt: "select_account",
    scope: GOOGLE_SIGNIN_SCOPES,
    state,
  });
  res.redirect(url);
});

googleAuthRouter.get("/auth/google/signin/callback", async (req, res) => {
  const frontendUrl = FRONTEND_URL();
  res.clearCookie(SIGNIN_STATE_COOKIE, { path: "/auth/google" });
  if (req.query.error) return res.redirect(`${frontendUrl}/login?google_error=access_denied`);

  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;
  const cookieState = readCookie(req, SIGNIN_STATE_COOKIE);
  const stored = await consumeOAuthState(state, "signin");
  if (!code || !stored || !cookieState || cookieState !== state) {
    return res.redirect(`${frontendUrl}/login?google_error=invalid_state`);
  }

  try {
    const client = getOAuthClient(signinRedirectUri());
    const { tokens } = await client.getToken(code);
    if (!tokens.id_token) return res.redirect(`${frontendUrl}/login?google_error=no_id_token`);

    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
    const claims = ticket.getPayload();
    const googleSub = claims?.sub;
    const googleEmail = claims?.email?.toLowerCase();
    if (!googleSub || !googleEmail) return res.redirect(`${frontendUrl}/login?google_error=missing_profile`);
    // Never link or create an account from an address Google hasn't verified — otherwise
    // an unverified Google account claiming someone's email could take over their login.
    if (claims?.email_verified !== true) return res.redirect(`${frontendUrl}/login?google_error=email_unverified`);

    let user = (await pool.query("SELECT id FROM users WHERE google_sub = $1", [googleSub])).rows[0];
    if (!user) {
      user = (await pool.query("SELECT id FROM users WHERE email = $1", [googleEmail])).rows[0];
      if (user) {
        await pool.query("UPDATE users SET google_sub = $1, google_email = $2 WHERE id = $3", [googleSub, googleEmail, user.id]);
      } else {
        user = (
          await pool.query(
            `INSERT INTO users (email, name, role, google_sub, google_email) VALUES ($1, $2, 'FOUNDER', $3, $4)
             ON CONFLICT (email) DO UPDATE SET google_sub = EXCLUDED.google_sub RETURNING id`,
            [googleEmail, claims?.name ?? null, googleSub, googleEmail]
          )
        ).rows[0];
      }
    }

    const oneTimeCode = await createOAuthState("signin_code", user.id, SIGNIN_CODE_TTL_MS);
    res.redirect(`${frontendUrl}/login?google_code=${encodeURIComponent(oneTimeCode)}`);
  } catch (err) {
    console.error("Google Sign-In callback failed:", (err as Error).message);
    res.redirect(`${frontendUrl}/login?google_error=auth_failed`);
  }
});

/** Exchanges the one-time code from the Sign-In redirect for a session token (POST, never in a URL). */
export async function exchangeSignInCode(code: string) {
  const stored = await consumeOAuthState(code, "signin_code");
  if (!stored?.userId) return null;
  const user = (await pool.query("SELECT id, email, name, role FROM users WHERE id = $1", [stored.userId])).rows[0];
  if (!user) return null;
  return { token: signToken({ userId: user.id, role: user.role }), user };
}
