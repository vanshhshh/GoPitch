import { pool } from "../lib/db";
import { getGmailClientForUser, userHasGmailModifyScope } from "../routes/googleAuth";

const GMAIL_OAUTH_SCOPE = (process.env.GMAIL_OAUTH_SCOPE || "modify").toLowerCase();
const WATCHER_REQUIRES_MODIFY = GMAIL_OAUTH_SCOPE !== "send";

export interface GmailWatchResult {
  userId: string;
  processed: number;
  replied: number;
  errors: string[];
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
    const sentSends = await pool.query(
      `SELECT es.*, i.email AS investor_email FROM email_sends es
       JOIN investors i ON i.id = es.investor_id
       WHERE es.user_id = $1 AND es.status = 'SENT' AND es.gmail_thread_id IS NOT NULL
       ORDER BY es.sent_at DESC LIMIT 200`,
      [userId]
    );

    for (const send of sentSends.rows) {
      result.processed++;
      try {
        const threadResponse = await gmail.users.threads.get({
          userId: "me",
          id: send.gmail_thread_id,
          format: "metadata",
          metadataHeaders: ["From", "To", "Subject", "Message-ID", "In-Reply-To", "References"],
        });

        const messages = threadResponse.data.messages || [];
        const lastMessage = messages[messages.length - 1];
        if (!lastMessage || !lastMessage.payload?.headers) continue;

        const headers = new Map(
          (lastMessage.payload.headers || []).map((h: any) => [h.name?.toLowerCase?.() || "", h.value || ""])
        );

        const from = headers.get("from") || "";
        const to = headers.get("to") || "";
        const messageId = headers.get("message-id") || "";

        const isOutbound = from.toLowerCase().includes(userRow.connected_gmail_address?.toLowerCase() || userRow.email.toLowerCase());
        const isInbound = !isOutbound;
        const addressedToUser = to.toLowerCase().includes(userRow.connected_gmail_address?.toLowerCase() || userRow.email.toLowerCase());

        if (!isInbound || !addressedToUser) continue;
        if (messages.length <= 1) continue;

        const existingReplied = await pool.query(
          "SELECT id FROM email_sends WHERE id = $1 AND status = 'REPLIED'",
          [send.id]
        );
        if (existingReplied.rows.length > 0) {
          result.replied++;
          continue;
        }

        await pool.query(
          `UPDATE email_sends SET status = 'REPLIED', replied_at = now() WHERE id = $1`,
          [send.id]
        );

        const investor = await pool.query("SELECT name FROM investors WHERE id = $1", [send.investor_id]);
        const investorName = investor.rows[0]?.name || "An investor";

        await pool.query(
          `INSERT INTO notifications (user_id, type, title, body)
           VALUES ($1, 'investor_reply', 'Investor replied', $2)`,
          [
            userId,
            `${investorName} replied to your outreach email.`,
          ]
        );

        result.replied++;
      } catch (err: any) {
        if (err?.code === 404 || err?.code === 403) {
          result.errors.push(`Thread ${send.gmail_thread_id}: ${err.message}`);
        }
      }
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
