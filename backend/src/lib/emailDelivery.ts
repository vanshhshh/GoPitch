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
}

function buildRfc2822Message(email: OutboundEmail, fromAddress: string): string {
  const fromHeader = email.fromName ? `${email.fromName} <${fromAddress}>` : fromAddress;
  const lines = [
    `From: ${fromHeader}`,
    `To: ${email.to}`,
    `Subject: ${email.subject}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    "",
    email.body,
  ];
  return lines.join("\r\n");
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
  const gmail = await getGmailClientForUser(userId);
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
    return { delivered: false, via: "gmail_api", error: err?.message || "Gmail API send failed." };
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
