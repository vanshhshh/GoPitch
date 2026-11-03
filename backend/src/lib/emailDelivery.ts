/**
 * emailDelivery.ts
 *
 * Two delivery paths:
 *  1. Gmail API send via the founder's own connected OAuth account — the production
 *     path. Uses gmail.users.messages.send with a base64url-encoded RFC 2822 message.
 *  2. SMTP with an app password — an explicit, clearly-labeled DEV-ONLY fallback for
 *     testing the send pipeline before Gmail OAuth is connected. This must never be the
 *     path a real founder's campaign uses in production; it's gated behind
 *     SMTP_FALLBACK_ENABLED and only ever sends as the platform's own configured
 *     SMTP_USER, never as an arbitrary founder, which is exactly why it can't replace
 *     OAuth for real campaigns — there's no way to send AS the founder over plain SMTP
 *     without their own credentials.
 */

import nodemailer from "nodemailer";
import { getGmailClientForUser } from "../routes/googleAuth";

export interface OutboundEmail {
  to: string;
  subject: string;
  body: string;
  fromName?: string;
}

export interface DeliveryResult {
  delivered: boolean;
  via: "gmail_api" | "smtp_fallback" | "none";
  messageId?: string | undefined;
  threadId?: string | undefined;
  error?: string | undefined;
  /** The founder's Google grant is gone (revoked / expired refresh token) — reconnect needed. */
  authRevoked?: boolean;
  /** Gmail is rate limiting this account — stop the batch and retry later. */
  rateLimited?: boolean;
}

/** Strips CR/LF so a subject or name (AI-generated or founder-edited) can never inject headers. */
export function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/** RFC 2047 encoded-word for non-ASCII header text (subjects, display names). */
export function encodeHeaderWord(value: string): string {
  const clean = sanitizeHeaderValue(value);
  if (/^[\x20-\x7e]*$/.test(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, "utf-8").toString("base64")}?=`;
}

export function buildRfc2822Message(email: OutboundEmail, fromAddress: string): string {
  const safeFromAddress = sanitizeHeaderValue(fromAddress);
  const fromHeader = email.fromName
    ? `${encodeHeaderWord(email.fromName.replace(/["<>]/g, ""))} <${safeFromAddress}>`
    : safeFromAddress;
  // Base64 body: safe for any UTF-8 content (₹, names with accents) through any relay.
  const bodyBase64 = Buffer.from(email.body, "utf-8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  const lines = [
    `From: ${fromHeader}`,
    `To: ${sanitizeHeaderValue(email.to)}`,
    `Subject: ${encodeHeaderWord(email.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: text/plain; charset="UTF-8"`,
    "Content-Transfer-Encoding: base64",
    "",
    bodyBase64,
  ];
  return lines.join("\r\n");
}

export function classifyGmailError(err: any): { authRevoked: boolean; rateLimited: boolean } {
  const message = String(err?.response?.data?.error ?? err?.message ?? "");
  const status = Number(err?.code ?? err?.response?.status ?? 0);
  return {
    authRevoked: /invalid_grant/i.test(message) || status === 401,
    rateLimited: status === 429 || /rate ?limit|user-rate/i.test(message),
  };
}

function toBase64Url(input: string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Production path: sends via the founder's own connected Gmail account. */
export async function sendViaGmailApi(userId: string, email: OutboundEmail, fromAddress: string): Promise<DeliveryResult> {
  let gmail;
  try {
    gmail = await getGmailClientForUser(userId);
  } catch {
    // The stored token could not be decrypted (e.g. encryption key rotated) — treat as revoked.
    return { delivered: false, via: "gmail_api", error: "Stored Gmail credentials are unreadable. Reconnect Gmail.", authRevoked: true };
  }
  if (!gmail) {
    return { delivered: false, via: "none", error: "No Gmail account connected for this user." };
  }

  try {
    const raw = toBase64Url(buildRfc2822Message(email, fromAddress));
    const response = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });
    return {
      delivered: true,
      via: "gmail_api",
      messageId: response.data.id ?? undefined,
      threadId: response.data.threadId ?? undefined,
    };
  } catch (err: any) {
    const { authRevoked, rateLimited } = classifyGmailError(err);
    return {
      delivered: false,
      via: "gmail_api",
      error: authRevoked
        ? "Gmail access was revoked or expired. Reconnect Gmail in Settings."
        : rateLimited
          ? "Gmail is rate limiting this account. Try again later."
          : err?.message || "Gmail API send failed.",
      authRevoked,
      rateLimited,
    };
  }
}

/**
 * Dev-only fallback: sends over SMTP using an app password, always FROM the platform's
 * own configured account (SMTP_USER), never as the founder. Only used when
 * SMTP_FALLBACK_ENABLED=true, and only intended for exercising the send pipeline before
 * a founder has connected their own Gmail — see the module docstring above.
 */
export async function sendViaSmtpFallback(email: OutboundEmail): Promise<DeliveryResult> {
  if (process.env.NODE_ENV === "production") {
    return { delivered: false, via: "none", error: "SMTP fallback is disabled in production." };
  }
  if (process.env.SMTP_FALLBACK_ENABLED !== "true") {
    return { delivered: false, via: "none", error: "SMTP fallback is disabled." };
  }
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_APP_PASSWORD;
  if (!user || !pass) {
    return { delivered: false, via: "none", error: "SMTP fallback credentials are not configured." };
  }

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
    });
    const info = await transporter.sendMail({
      from: `"GoPitch test relay" <${user}>`,
      to: email.to,
      subject: email.subject,
      text: `${email.body}\n\n---\nSent from the local test relay. Connect Gmail OAuth for real founder sends.`,
    });
    return { delivered: true, via: "smtp_fallback", messageId: info.messageId };
  } catch (err: any) {
    return { delivered: false, via: "smtp_fallback", error: err?.message || "SMTP send failed." };
  }
}

/**
 * Top-level dispatcher: always prefers the founder's own connected Gmail. Only falls
 * back to SMTP when explicitly enabled AND no Gmail connection exists — this ordering
 * is what keeps SMTP a dev convenience rather than a silent production substitute.
 */
export async function deliverEmail(
  userId: string,
  email: OutboundEmail,
  connectedGmailAddress: string | null
): Promise<DeliveryResult> {
  if (connectedGmailAddress) {
    return sendViaGmailApi(userId, email, connectedGmailAddress);
  }
  if (process.env.SMTP_FALLBACK_ENABLED === "true") {
    return sendViaSmtpFallback(email);
  }
  return { delivered: false, via: "none", error: "No Gmail connected and SMTP fallback is disabled." };
}
