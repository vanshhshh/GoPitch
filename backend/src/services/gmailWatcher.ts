import { pool } from "../lib/db";
import { getGmailClientForUser, userHasGmailModifyScope } from "../routes/googleAuth";

const GMAIL_OAUTH_SCOPE = (process.env.GMAIL_OAUTH_SCOPE || "modify").toLowerCase();
const WATCHER_REQUIRES_MODIFY = GMAIL_OAUTH_SCOPE !== "send";

const RECENT_RECHECK_LIMIT = 50;
const BATCH_LIMIT = 200;

export interface GmailWatchResult {
  userId: string;
  processed: number;
  replied: number;
  errors: string[];
}

function parseHeaderDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) return null;
  return parsed;
}

function extractHeaders(headers: any[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const h of headers || []) {
    const name = h.name?.toLowerCase?.() || "";
    const value = h.value || "";
    if (name) map.set(name, value);
  }
  return map;
}

async function getRecentSends(pool: any, userId: string): Promise<any[]> {
  const result = await pool.query(
    `SELECT es.*, i.email AS investor_email FROM email_sends es
     JOIN investors i ON i.id = es.investor_id
     WHERE es.user_id = $1 AND es.status = 'SENT' AND es.gmail_thread_id IS NOT NULL
     ORDER BY es.sent_at DESC LIMIT $2`,
    [userId, RECENT_RECHECK_LIMIT]
  );
  return result.rows;
}

async function getOlderSends(pool: any, userId: string, cursor: string | null): Promise<{ rows: any[]; oldestSentAt: string | null }> {
  const result = await pool.query(
    `SELECT es.*, i.email AS investor_email FROM email_sends es
     JOIN investors i ON i.id = es.investor_id
     WHERE es.user_id = $1 AND es.status = 'SENT' AND es.gmail_thread_id IS NOT NULL
       AND ($2::timestamptz IS NULL OR es.sent_at < $2)
     ORDER BY es.sent_at DESC LIMIT $3`,
    [userId, cursor, BATCH_LIMIT]
  );

  let oldestSentAt: string | null = null;
  for (const row of result.rows) {
    if (!oldestSentAt || row.sent_at < oldestSentAt) {
      oldestSentAt = row.sent_at;
    }
  }
  return { rows: result.rows, oldestSentAt };
}

function hasInboundInvestorReply(messages: any[], userEmail: string, originalSentAt: string): boolean {
  for (const msg of messages) {
    const headers = extractHeaders(msg.payload?.headers || []);
    const from = headers.get("from") || "";
    const to = headers.get("to") || "";
    const dateStr = headers.get("date") || "";

    const isOutbound = from.toLowerCase().includes(userEmail.toLowerCase());
    if (isOutbound) continue;

    const addressedToUser = to.toLowerCase().includes(userEmail.toLowerCase());
    if (!addressedToUser) continue;

    const messageDate = parseHeaderDate(dateStr);
    if (!messageDate) continue;

    const sentAt = new Date(originalSentAt);
    if (messageDate <= sentAt) continue;

    return true;
  }
  return false;
}

async function markAsReplied(pool: any, userId: string, send: any, userRow: any): Promise<void> {
  await pool.query(
    `UPDATE email_sends SET status = 'REPLIED', replied_at = now() WHERE id = $1`,
    [send.id]
  );

  const investorResult = await pool.query("SELECT name FROM investors WHERE id = $1", [send.investor_id]);
  const investorName = investorResult.rows[0]?.name || "An investor";

  await pool.query(
    `INSERT INTO notifications (user_id, type, title, body)
     VALUES ($1, 'investor_reply', 'Investor replied', $2)`,
    [userId, `${investorName} replied to your outreach email.`]
  );
}

export async function checkGmailRepliesForUser(userId: string): Promise<GmailWatchResult> {
  const result: GmailWatchResult = { userId, processed: 0, replied: 0, errors: [] };

  if (!WATCHER_REQUIRES_MODIFY) {
    result.errors.push("Gmail watcher disabled — GMAIL_OAUTH_SCOPE is set to 'send'.");
    return result;
  }

  const userRow = (await pool.query("SELECT * FROM users WHERE id = $1", [userId])).rows[0];
  if (!userRow || !userRow.google_refresh_token) return result;

  if (!userHasGmailModifyScope(userRow.gmail_granted_scopes)) {
    result.errors.push("Insufficient Gmail scope — user needs to reconnect with gmail.modify.");
    return result;
  }

  const gmail = await getGmailClientForUser(userId);
  if (!gmail) return result;

  try {
    const recentSends = await getRecentSends(pool, userId);
    const cursor = userRow.gmail_watch_cursor;
    const { rows: olderSends, oldestSentAt } = await getOlderSends(pool, userId, cursor);

    const seen = new Set<string>();
    const sends: any[] = [];
    for (const s of recentSends) {
      if (!seen.has(s.id)) {
        seen.add(s.id);
        sends.push(s);
      }
    }
    for (const s of olderSends) {
      if (!seen.has(s.id)) {
        seen.add(s.id);
        sends.push(s);
      }
    }

    for (const send of sends) {
      result.processed++;
      try {
        const threadResponse = await gmail.users.threads.get({
          userId: "me",
          id: send.gmail_thread_id,
          format: "metadata",
          metadataHeaders: ["From", "To", "Subject", "Date", "Message-ID", "In-Reply-To", "References"],
        });

        const messages = threadResponse.data.messages || [];
        if (messages.length <= 1) continue;

        const hasReply = hasInboundInvestorReply(messages, userRow.connected_gmail_address || userRow.email, send.sent_at);
        if (!hasReply) continue;

        const existingReplied = await pool.query(
          "SELECT id FROM email_sends WHERE id = $1 AND status = 'REPLIED'",
          [send.id]
        );
        if (existingReplied.rows.length > 0) {
          result.replied++;
          continue;
        }

        await markAsReplied(pool, userId, send, userRow);
        result.replied++;
      } catch (err: any) {
        if (err?.code === 404 || err?.code === 403) {
          result.errors.push(`Thread ${send.gmail_thread_id}: ${err.message}`);
        }
      }
    }

    if (olderSends.length >= BATCH_LIMIT && oldestSentAt) {
      await pool.query("UPDATE users SET gmail_watch_cursor = $1 WHERE id = $2", [oldestSentAt, userId]);
    } else {
      await pool.query("UPDATE users SET gmail_watch_cursor = NULL WHERE id = $1", [userId]);
    }
  } catch (err: any) {
    result.errors.push(`Gmail API error: ${err.message}`);
  }

  return result;
}

export async function checkGmailRepliesForAllUsers(): Promise<GmailWatchResult[]> {
  const users = await pool.query(
    `SELECT id FROM users WHERE google_refresh_token IS NOT NULL AND gmail_connected_at IS NOT NULL`
  );

  const results: GmailWatchResult[] = [];
  for (const row of users.rows) {
    try {
      const result = await checkGmailRepliesForUser(row.id);
      results.push(result);
    } catch (err: any) {
      results.push({ userId: row.id, processed: 0, replied: 0, errors: [err.message] });
    }
  }
  return results;
}
