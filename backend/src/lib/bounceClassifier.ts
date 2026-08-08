/**
 * bounceClassifier.ts
 *
 * Classifies an inbound email (typically a delivery-failure notice landing back in the
 * founder's own inbox, or a Gmail Postmaster/Pub-Sub push event) as a bounce, a spam
 * complaint, or neither. This is the pure decision logic — kept separate from the Gmail
 * API wiring in routes/gmailWebhook.ts so it's fully testable without any live credentials.
 *
 * Two real-world sources feed this:
 *  1. Gmail API Pub/Sub push notifications (via `users.watch`) — delivers new message IDs,
 *     which get fetched via `users.messages.get` and passed through here.
 *  2. Google Postmaster Tools API — gives aggregate spam-rate/reputation data per sending
 *     domain, useful for domain-level accounts but not per-message classification.
 *
 * This module handles case 1: classifying an individual inbound message.
 */

export type BounceClassification = "hard_bounce" | "soft_bounce" | "complaint" | "none";

export interface InboundMessageSummary {
  fromAddress: string;
  subject: string;
  snippet: string;
  headers: Record<string, string>;
}

const MAILER_DAEMON_PATTERNS = [
  /mailer-daemon/i,
  /postmaster@/i,
  /mail delivery (subsystem|failed|failure)/i,
];

const HARD_BOUNCE_PATTERNS = [
  /address not found/i,
  /user (unknown|not found)/i,
  /no such user/i,
  /mailbox (unavailable|not found|does not exist)/i,
  /550/, // SMTP permanent failure code
  /553/,
];

const SOFT_BOUNCE_PATTERNS = [
  /mailbox full/i,
  /quota exceeded/i,
  /temporarily (unavailable|deferred)/i,
  /421/, // SMTP temporary failure code
  /450/,
  /452/,
];

const COMPLAINT_PATTERNS = [
  /this is spam/i,
  /marked as spam/i,
  /feedback loop/i,
  /abuse report/i,
  /unsubscribe.*complaint/i,
];

const COMPLAINT_HEADER_KEYS = ["x-loop", "feedback-id", "x-spam-flag"];

/**
 * Classifies a single inbound message. Order matters: complaint detection runs first
 * because a spam-complaint feedback-loop message can also mention delivery-failure-like
 * language, and complaints are the more severe signal — sendScheduler.ts hard-stops
 * sending on any complaint, so a false negative here is worse than a false positive on
 * bounce classification.
 */
export function classifyInboundMessage(message: InboundMessageSummary): BounceClassification {
  const haystack = `${message.subject}\n${message.snippet}`.toLowerCase();
  const isFromMailerDaemon = MAILER_DAEMON_PATTERNS.some((p) => p.test(message.fromAddress) || p.test(haystack));

  const hasComplaintHeader = COMPLAINT_HEADER_KEYS.some((key) => key in normalizeHeaderKeys(message.headers));
  const hasComplaintPattern = COMPLAINT_PATTERNS.some((p) => p.test(haystack));
  if (hasComplaintHeader || hasComplaintPattern) {
    return "complaint";
  }

  if (isFromMailerDaemon) {
    if (HARD_BOUNCE_PATTERNS.some((p) => p.test(haystack))) return "hard_bounce";
    if (SOFT_BOUNCE_PATTERNS.some((p) => p.test(haystack))) return "soft_bounce";
    // From mailer-daemon but no specific pattern matched — treat conservatively as a
    // soft bounce rather than silently dropping a signal we don't recognize.
    return "soft_bounce";
  }

  return "none";
}

function normalizeHeaderKeys(headers: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[key.toLowerCase()] = value;
  }
  return normalized;
}

/**
 * Extracts the original recipient's email address from a bounce notice's body, so the
 * caller knows which investor_id / email_sends row to mark BOUNCED. Real bounce messages
 * embed the failed recipient in the body (RFC 3464 format) — this handles the common
 * "Final-Recipient:" and "To:" style patterns most providers use.
 */
export function extractBouncedRecipient(bodyText: string): string | null {
  const finalRecipientMatch = bodyText.match(/Final-Recipient:\s*rfc822;\s*([^\s<>]+@[^\s<>]+)/i);
  if (finalRecipientMatch?.[1]) return finalRecipientMatch[1].toLowerCase();

  const genericMatch = bodyText.match(/(?:to|recipient)[:\s]+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
  if (genericMatch?.[1]) return genericMatch[1].toLowerCase();

  return null;
}
