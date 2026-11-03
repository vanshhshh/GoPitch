import { Router } from "express";
import { z } from "zod";
import { pool, Queryable, withUserLock } from "../lib/db";
import { requireAuth } from "../lib/auth";
import {
  evaluateSend,
  UserSendState,
  applyReputationEvent,
  accountAgeDaysSince,
  warmupStatus,
  nextDailyResetAt,
} from "../services/sendScheduler";
import { deliverEmail, sanitizeHeaderValue } from "../lib/emailDelivery";
import { classifyInboundMessage, extractBouncedRecipient } from "../lib/bounceClassifier";
import { createNotification } from "./notifications";
import { countSentToday, loadEntitlement } from "../services/entitlementService";
import { disconnectGmail } from "./googleAuth";

export const sendRouter = Router();
sendRouter.use(requireAuth);

const SEND_STATUSES = ["QUEUED", "SENT", "REPLIED", "BOUNCED", "FAILED", "SKIPPED_CAP_REACHED", "CANCELLED"] as const;

/** Real per-status counts for the founder's sends. */
async function countSendsByStatus(userId: string, db: Queryable = pool): Promise<Record<string, number>> {
  const result = await db.query("SELECT status, COUNT(*)::int AS count FROM email_sends WHERE user_id = $1 GROUP BY status", [userId]);
  const counts: Record<string, number> = {};
  for (const status of SEND_STATUSES) counts[status] = 0;
  for (const row of result.rows) counts[row.status] = row.count;
  return counts;
}

async function loadSendState(userId: string, userRow: any, db: Queryable = pool): Promise<UserSendState> {
  const bounceResult = await db.query(
    `SELECT COUNT(*)::int AS count FROM email_sends
     WHERE user_id = $1 AND status = 'BOUNCED' AND bounced_at >= now() - interval '7 days'`,
    [userId]
  );
  return {
    accountAgeDays: accountAgeDaysSince(userRow.gmail_connected_at),
    sendReputationScore: userRow.send_reputation_score,
    sentTodayCount: await countSentToday(userId, db),
    bounceCountLast7Days: bounceResult.rows[0].count,
    complaintCountLast7Days:
      userRow.complaint_reported_at && new Date(userRow.complaint_reported_at).getTime() > Date.now() - 7 * 86_400_000 ? 1 : 0,
  };
}

/** Aggregate stats for the founder's own Analytics dashboard — real counts, not estimates. */
sendRouter.get("/analytics", async (req, res) => {
  const userId = req.auth!.userId;
  const sendsByStatus = await countSendsByStatus(userId);
  const totals = (
    await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE sent_at IS NOT NULL)::int AS sent,
         COUNT(*) FILTER (WHERE status = 'REPLIED')::int AS replied,
         COUNT(*) FILTER (WHERE status = 'BOUNCED')::int AS bounced,
         AVG(match_score)::float AS avg_score
       FROM email_sends WHERE user_id = $1`,
      [userId]
    )
  ).rows[0];
  const byDay = await pool.query(
    `SELECT date_trunc('day', sent_at AT TIME ZONE 'UTC') AS day, COUNT(*)::int AS count
     FROM email_sends WHERE user_id = $1 AND sent_at IS NOT NULL AND sent_at >= now() - interval '30 days'
     GROUP BY day ORDER BY day`,
    [userId]
  );
  const replyTracking = (
    await pool.query("SELECT gmail_granted_scopes FROM users WHERE id = $1", [userId])
  ).rows[0]?.gmail_granted_scopes;

  res.json({
    sendsByStatus,
    totals: {
      drafted: Object.values(sendsByStatus).reduce((a, b) => a + b, 0),
      sent: totals.sent,
      replied: totals.replied,
      bounced: totals.bounced,
    },
    // Reply counts are only meaningful when the watcher can actually read thread metadata.
    replyTrackingEnabled: process.env.GMAIL_WATCHER_ENABLED !== "false" && /gmail\.(metadata|readonly|modify)/.test(replyTracking || ""),
    averageMatchScore: totals.avg_score ? Math.round(totals.avg_score * 10) / 10 : null,
    sentByDay: byDay.rows.map((r) => ({ date: r.day, count: r.count })),
  });
});

sendRouter.get("/quota", async (req, res) => {
  const userId = req.auth!.userId;
  const entitlement = await loadEntitlement(userId);
  const userRow = (await pool.query("SELECT * FROM users WHERE id = $1", [userId])).rows[0];
  const state = await loadSendState(userId, userRow);
  const decision = evaluateSend(state);
  const counts = await countSendsByStatus(userId);

  res.json({
    entitlementTier: entitlement.tier,
    quotaWindowStart: entitlement.windowStart,
    // Plan allowance
    investorEmailsTotal: entitlement.quota.limit,
    investorEmailsSent: entitlement.quota.sent,
    investorEmailsQueued: entitlement.quota.queued,
    investorEmailsRemaining: entitlement.quota.remainingToSend,
    investorEmailsUnallocated: entitlement.quota.remainingToAllocate,
    quotaExhausted: entitlement.quota.exhausted,
    // Lifetime status counts (all campaigns)
    queuedEmails: counts.QUEUED,
    failedEmails: counts.FAILED,
    bouncedEmails: counts.BOUNCED,
    // Daily sending (warm-up ramp, enforced in dispatch)
    currentDailyLimit: decision.dailyCap,
    sentToday: state.sentTodayCount,
    remainingToday: decision.allowed ? decision.remainingToday : 0,
    sendingPausedReason: decision.allowed ? null : decision.reason,
    dailyResetsAt: nextDailyResetAt(),
    accountAgeDays: state.accountAgeDays,
    ...warmupStatus(state.accountAgeDays),
    gmailConnected: !!userRow.google_refresh_token,
  });
});

const listQuerySchema = z.object({
  status: z.enum(["ALL", ...SEND_STATUSES]).default("ALL"),
  campaignId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/** Paginated, server-filtered outreach list plus exact per-status counts. */
sendRouter.get("/", async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid query." });
  const { status, campaignId, page, pageSize } = parsed.data;
  const userId = req.auth!.userId;

  const where = ["es.user_id = $1"];
  const params: any[] = [userId];
  if (status !== "ALL") {
    params.push(status);
    where.push(`es.status = $${params.length}`);
  }
  if (campaignId) {
    params.push(campaignId);
    where.push(`es.campaign_id = $${params.length}`);
  }

  const total = (await pool.query(`SELECT COUNT(*)::int AS n FROM email_sends es WHERE ${where.join(" AND ")}`, params)).rows[0].n;
  params.push(pageSize, (page - 1) * pageSize);
  const result = await pool.query(
    `SELECT es.*, i.name AS investor_name, i.firm AS investor_firm, comp.name AS company_name
     FROM email_sends es
     JOIN investors i ON i.id = es.investor_id
     JOIN campaigns c ON c.id = es.campaign_id
     JOIN companies comp ON comp.id = c.company_id
     WHERE ${where.join(" AND ")}
     ORDER BY es.created_at DESC, es.match_score DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json({
    items: result.rows.map((r) => ({
      id: r.id,
      campaignId: r.campaign_id,
      investorName: r.investor_name,
      investorFirm: r.investor_firm,
      companyName: r.company_name,
      subject: r.subject,
      bodyText: r.body_text,
      matchScore: r.match_score,
      status: r.status,
      failureReason: r.failure_reason,
      scheduledFor: r.scheduled_for,
      sentAt: r.sent_at,
      bouncedAt: r.bounced_at,
      repliedAt: r.replied_at,
    })),
    total,
    page,
    pageSize,
    counts: await countSendsByStatus(userId),
  });
});

const editSendSchema = z.object({
  subject: z.string().trim().min(1).max(200).optional(),
  bodyText: z.string().trim().min(1).max(10000).optional(),
});

/** Founder edits a draft before it goes out. Only QUEUED drafts are editable. */
sendRouter.patch("/:sendId", async (req, res) => {
  const parsed = editSendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input." });
  const { subject, bodyText } = parsed.data;
  if (subject === undefined && bodyText === undefined) return res.status(400).json({ error: "Nothing to update." });

  const result = await pool.query(
    `UPDATE email_sends SET subject = COALESCE($1, subject), body_text = COALESCE($2, body_text)
     WHERE id = $3 AND user_id = $4 AND status = 'QUEUED' RETURNING id, subject, body_text, status`,
    [subject !== undefined ? sanitizeHeaderValue(subject) : null, bodyText ?? null, req.params.sendId, req.auth!.userId]
  );
  if (result.rows.length === 0) {
    return res.status(409).json({ error: "This email can no longer be edited (it was already sent, cancelled, or doesn't exist)." });
  }
  const row = result.rows[0];
  res.json({ id: row.id, subject: row.subject, bodyText: row.body_text, status: row.status });
});

/**
 * Sends the next batch of QUEUED emails for a campaign. The batch size is the smaller of
 * (a) what's left of today's warm-up cap and (b) what's left of the plan's email allowance,
 * so neither limit can be overshot by a large batch. The whole operation runs under a
 * per-user advisory lock: a second concurrent dispatch (double-click, two tabs, two API
 * instances) gets 409 instead of re-reading the same "sent today" count and the same
 * QUEUED rows — which previously could exceed the daily cap and email an investor twice.
 */
sendRouter.post("/campaigns/:campaignId/dispatch", async (req, res) => {
  const userId = req.auth!.userId;
  const campaignId = req.params.campaignId;

  const outcome = await withUserLock("dispatch", userId, async (db) => {
    const campaign = (await db.query("SELECT * FROM campaigns WHERE id = $1 AND user_id = $2", [campaignId, userId])).rows[0];
    if (!campaign) return { status: 404, body: { error: "Campaign not found." } };
    if (campaign.status !== "ACTIVE") {
      return { status: 409, body: { error: `This campaign is ${campaign.status.toLowerCase()} — resume it before sending.` } };
    }

    const entitlement = await loadEntitlement(userId, db);
    if (entitlement.quota.remainingToSend <= 0) {
      return {
        status: 402,
        body: {
          error: `You've used all ${entitlement.quota.limit} emails included in your ${entitlement.tier} plan. Upgrade to keep sending.`,
          entitlementTier: entitlement.tier,
          investorLimit: entitlement.quota.limit,
          upgradeRequired: true,
        },
      };
    }

    const userRow = (await db.query("SELECT * FROM users WHERE id = $1", [userId])).rows[0];
    const hasGmailConnection = !!userRow.google_refresh_token;
    const smtpFallbackAllowed = process.env.NODE_ENV !== "production" && process.env.SMTP_FALLBACK_ENABLED === "true";
    if (!hasGmailConnection && !smtpFallbackAllowed) {
      return { status: 400, body: { error: "Connect Gmail before sending.", gmailRequired: true } };
    }

    const decision = evaluateSend(await loadSendState(userId, userRow, db));
    if (!decision.allowed) {
      return { status: 429, body: { error: decision.reason, dailyCap: decision.dailyCap, dailyResetsAt: nextDailyResetAt() } };
    }

    const batchSize = Math.min(decision.remainingToday, entitlement.quota.remainingToSend);
    const queuedResult = await db.query(
      `SELECT es.*, i.email AS investor_email FROM email_sends es
       JOIN investors i ON i.id = es.investor_id
       WHERE es.campaign_id = $1 AND es.user_id = $2 AND es.status = 'QUEUED'
       ORDER BY es.match_score DESC LIMIT $3`,
      [campaign.id, userId, batchSize]
    );

    if (queuedResult.rows.length === 0) {
      await markCampaignCompletedIfDone(campaign.id, db);
      return { status: 200, body: { dispatched: 0, failed: 0, failures: [], message: "No queued emails remaining for this campaign." } };
    }

    const dispatched: string[] = [];
    const failed: { id: string; error: string }[] = [];
    let stopReason: string | null = null;

    for (const send of queuedResult.rows) {
      const result = await deliverEmail(
        userId,
        { to: send.investor_email, subject: send.subject, body: send.body_text, fromName: userRow.name },
        hasGmailConnection ? userRow.connected_gmail_address || userRow.email : null
      );

      if (result.delivered) {
        // Guarded on status = 'QUEUED' so a concurrent cancel can't be overwritten to SENT
        // after the fact, and a SENT row can never be re-marked.
        await db.query(
          `UPDATE email_sends SET status = 'SENT', sent_at = now(), gmail_message_id = $1, gmail_thread_id = $2,
             attempt_count = attempt_count + 1, failure_reason = NULL
           WHERE id = $3 AND status = 'QUEUED'`,
          [result.messageId ?? null, result.threadId ?? null, send.id]
        );
        dispatched.push(send.id);
        continue;
      }

      if (result.authRevoked || result.rateLimited) {
        // Account-level problem: leave this and the remaining drafts QUEUED and stop.
        stopReason = result.error ?? "Sending stopped.";
        if (result.authRevoked) {
          await disconnectGmail(userId, { revoke: false });
          await createNotification(userId, "gmail_disconnected", "Reconnect Gmail to keep sending", stopReason, db);
        }
        break;
      }

      await db.query(
        `UPDATE email_sends SET status = 'FAILED', failure_reason = $1, attempt_count = attempt_count + 1
         WHERE id = $2 AND status = 'QUEUED'`,
        [(result.error ?? "Unknown delivery failure.").slice(0, 500), send.id]
      );
      failed.push({ id: send.id, error: result.error ?? "Unknown delivery failure." });
    }

    if (dispatched.length > 0) {
      await db.query("UPDATE users SET send_reputation_score = LEAST(1.0, send_reputation_score + $1) WHERE id = $2", [
        0.01 * dispatched.length,
        userId,
      ]);
      await createNotification(
        userId,
        "send_dispatched",
        `${dispatched.length} outreach email${dispatched.length === 1 ? "" : "s"} sent`,
        failed.length > 0 ? `${failed.length} failed to send — retry them from Campaigns.` : undefined,
        db
      );
    }
    await markCampaignCompletedIfDone(campaign.id, db);

    return {
      status: 200,
      body: {
        dispatched: dispatched.length,
        failed: failed.length,
        failures: failed,
        stoppedReason: stopReason,
        remainingCapToday: Math.max(0, decision.remainingToday - dispatched.length),
        remainingQuota: Math.max(0, entitlement.quota.remainingToSend - dispatched.length),
      },
    };
  });

  if (!outcome.acquired) {
    return res.status(409).json({ error: "A send is already in progress for your account. Wait for it to finish." });
  }
  res.status(outcome.result.status).json(outcome.result.body);
});

/** A campaign with nothing left QUEUED is complete (FAILED ones can be retried, which re-activates it). */
export async function markCampaignCompletedIfDone(campaignId: string, db: Queryable = pool) {
  await db.query(
    `UPDATE campaigns SET status = 'COMPLETED', updated_at = now()
     WHERE id = $1 AND status = 'ACTIVE'
       AND NOT EXISTS (SELECT 1 FROM email_sends WHERE campaign_id = $1 AND status IN ('QUEUED','FAILED'))`,
    [campaignId]
  );
}

/**
 * Marks a send as bounced or a complaint, using the real classifier in
 * bounceClassifier.ts. Called by whatever inbound-message watcher you wire up — this route
 * is the classification + DB-update endpoint; it doesn't itself connect to Gmail.
 */
sendRouter.post("/inbound-message", async (req, res) => {
  const userId = req.auth!.userId;
  const { fromAddress, subject, snippet, headers, bodyText } = req.body as {
    fromAddress: string;
    subject: string;
    snippet: string;
    headers?: Record<string, string>;
    bodyText?: string;
  };

  if (!fromAddress || !subject) {
    return res.status(400).json({ error: "fromAddress and subject are required." });
  }

  const classification = classifyInboundMessage({ fromAddress, subject, snippet: snippet ?? "", headers: headers ?? {} });

  if (classification === "none") {
    return res.json({ classification, action: "none" });
  }

  if (classification === "complaint") {
    await pool.query("UPDATE users SET complaint_reported_at = now(), send_reputation_score = 0 WHERE id = $1", [userId]);
    await createNotification(
      userId,
      "complaint",
      "Sending paused — spam complaint detected",
      "A recipient marked one of your emails as spam. Sending is paused until an admin reviews and clears this."
    );
    return res.json({ classification, action: "sending_paused" });
  }

  const recipientEmail = bodyText ? extractBouncedRecipient(bodyText) : null;
  if (recipientEmail) {
    const matchingSend = await pool.query(
      `SELECT es.id FROM email_sends es JOIN investors i ON i.id = es.investor_id
       WHERE es.user_id = $1 AND i.email = $2 AND es.status = 'SENT'
       ORDER BY es.sent_at DESC LIMIT 1`,
      [userId, recipientEmail]
    );
    if (matchingSend.rows.length > 0) {
      await pool.query("UPDATE email_sends SET status = 'BOUNCED', bounced_at = now() WHERE id = $1 AND status = 'SENT'", [
        matchingSend.rows[0].id,
      ]);
    }
  }

  const currentScore = (await pool.query("SELECT send_reputation_score FROM users WHERE id = $1", [userId])).rows[0]
    .send_reputation_score;
  const newScore = applyReputationEvent(currentScore, "bounce");
  await pool.query("UPDATE users SET send_reputation_score = $1 WHERE id = $2", [newScore, userId]);

  res.json({ classification, action: "reputation_updated", matchedRecipient: recipientEmail });
});

/** Manual override — lets a founder flag a bounce on an email that was actually sent. */
sendRouter.post("/:sendId/bounce", async (req, res) => {
  const userId = req.auth!.userId;
  const result = await pool.query(
    `UPDATE email_sends SET status = 'BOUNCED', bounced_at = now()
     WHERE id = $1 AND user_id = $2 AND sent_at IS NOT NULL AND status IN ('SENT','REPLIED') RETURNING id`,
    [req.params.sendId, userId]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: "No sent email with that id." });

  const currentScore = (await pool.query("SELECT send_reputation_score FROM users WHERE id = $1", [userId])).rows[0]
    .send_reputation_score;
  await pool.query("UPDATE users SET send_reputation_score = $1 WHERE id = $2", [applyReputationEvent(currentScore, "bounce"), userId]);
  res.json({ ok: true });
});
