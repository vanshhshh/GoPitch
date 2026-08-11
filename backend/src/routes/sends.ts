import { Router } from "express";
import { pool } from "../lib/db";
import { requireAuth } from "../lib/auth";
import { evaluateSend, UserSendState, applyReputationEvent, getWarmupCap } from "../services/sendScheduler";
import { deliverEmail } from "../lib/emailDelivery";
import { classifyInboundMessage, extractBouncedRecipient } from "../lib/bounceClassifier";
import { createNotification } from "./notifications";
import { resolveEntitlementTier, PLAN_LIMITS, PlanTierId } from "../services/pricingService";

export const sendRouter = Router();
sendRouter.use(requireAuth);

/** Aggregate stats for the founder's own Analytics dashboard — real counts, not estimates. */
sendRouter.get("/analytics", async (req, res) => {
  const userId = req.auth!.userId;
  const byStatus = await pool.query(
    "SELECT status, COUNT(*)::int AS count FROM email_sends WHERE user_id = $1 GROUP BY status",
    [userId]
  );
  const avgScore = await pool.query(
    "SELECT AVG(match_score)::float AS avg FROM email_sends WHERE user_id = $1",
    [userId]
  );
  const byDay = await pool.query(
    `SELECT date_trunc('day', sent_at) AS day, COUNT(*)::int AS count
     FROM email_sends WHERE user_id = $1 AND status = 'SENT' AND sent_at >= now() - interval '30 days'
     GROUP BY day ORDER BY day`,
    [userId]
  );

  const statusCounts: Record<string, number> = {};
  for (const row of byStatus.rows) statusCounts[row.status] = row.count;

  res.json({
    sendsByStatus: statusCounts,
    averageMatchScore: avgScore.rows[0].avg ? Math.round(avgScore.rows[0].avg * 10) / 10 : null,
    sentByDay: byDay.rows.map((r) => ({ date: r.day, count: r.count })),
  });
});

sendRouter.get("/quota", async (req, res) => {
  const userId = req.auth!.userId;

  const subscriptionRow = await pool.query("SELECT tier, status, current_period_end FROM subscriptions WHERE user_id = $1", [userId]);
  const entitlementTier = resolveEntitlementTier(subscriptionRow.rows[0] || undefined);
  const limits = PLAN_LIMITS[entitlementTier];

  const totalSentResult = await pool.query(
    "SELECT COUNT(*)::int AS count FROM email_sends WHERE user_id = $1 AND status = 'SENT'",
    [userId]
  );
  const totalSent = totalSentResult.rows[0].count;

  const queuedResult = await pool.query(
    "SELECT COUNT(*)::int AS count FROM email_sends WHERE user_id = $1 AND status = 'QUEUED'",
    [userId]
  );
  const queued = queuedResult.rows[0].count;

  const sentTodayResult = await pool.query(
    `SELECT COUNT(*)::int AS count FROM email_sends
     WHERE user_id = $1 AND status = 'SENT' AND sent_at >= date_trunc('day', now())`,
    [userId]
  );
  const sentToday = sentTodayResult.rows[0].count;

  const userRow = (await pool.query("SELECT * FROM users WHERE id = $1", [userId])).rows[0];
  const accountAgeDays = userRow.gmail_connected_at
    ? Math.floor((Date.now() - new Date(userRow.gmail_connected_at).getTime()) / 86_400_000)
    : 0;
  const warmupCap = getWarmupCap(accountAgeDays);
  const remainingToday = Math.max(0, warmupCap - sentToday);

  res.json({
    entitlementTier,
    investorEmailsTotal: limits.investorEmails,
    investorEmailsSent: totalSent,
    investorEmailsRemaining: limits.investorEmails === Number.MAX_SAFE_INTEGER ? null : Math.max(0, limits.investorEmails - totalSent),
    queuedEmails: queued,
    dailySendLimit: limits.dailySendLimit,
    warmupDailyLimit: limits.warmupDailyLimit,
    postWarmupDailyLimit: limits.postWarmupDailyLimit,
    currentDailyLimit: warmupCap,
    sentToday,
    remainingToday,
    accountAgeDays,
    warmupCap,
  });
});
sendRouter.get("/", async (req, res) => {
  const result = await pool.query(
    `SELECT es.*, i.name AS investor_name, i.firm AS investor_firm, comp.name AS company_name
     FROM email_sends es
     JOIN investors i ON i.id = es.investor_id
     JOIN campaigns c ON c.id = es.campaign_id
     JOIN companies comp ON comp.id = c.company_id
     WHERE es.user_id = $1
     ORDER BY es.created_at DESC LIMIT 300`,
    [req.auth!.userId]
  );
  res.json(
    result.rows.map((r) => ({
      id: r.id,
      investorName: r.investor_name,
      investorFirm: r.investor_firm,
      companyName: r.company_name,
      subject: r.subject,
      matchScore: r.match_score,
      status: r.status,
      scheduledFor: r.scheduled_for,
      sentAt: r.sent_at,
      bouncedAt: r.bounced_at,
      repliedAt: r.replied_at,
      gmailMessageId: r.gmail_message_id,
      gmailThreadId: r.gmail_thread_id,
    }))
  );
});

/**
 * Approves and sends the next batch of QUEUED emails for a campaign, respecting the
 * per-user rate limit computed from real send history. Sends via the founder's own
 * connected Gmail (production path) or the SMTP dev fallback if explicitly enabled and
 * no Gmail is connected — see lib/emailDelivery.ts for why those two paths never blur
 * together.
 */
sendRouter.post("/campaigns/:campaignId/dispatch", async (req, res) => {
  const userId = req.auth!.userId;

  const campaign = (
    await pool.query("SELECT * FROM campaigns WHERE id = $1 AND user_id = $2", [req.params.campaignId, userId])
  ).rows[0];
  if (!campaign) return res.status(404).json({ error: "Campaign not found." });

  const subscriptionRow = await pool.query("SELECT tier, status, current_period_end FROM subscriptions WHERE user_id = $1", [userId]);
  const entitlementTier = resolveEntitlementTier(subscriptionRow.rows[0] || undefined);
  const limits = PLAN_LIMITS[entitlementTier];

  const totalSentResult = await pool.query(
    "SELECT COUNT(*)::int AS count FROM email_sends WHERE user_id = $1 AND status = 'SENT'",
    [userId]
  );
  const totalSent = totalSentResult.rows[0].count;
  if (limits.investorEmails !== Number.MAX_SAFE_INTEGER && totalSent >= limits.investorEmails) {
    return res.status(403).json({
      error: `Your ${entitlementTier} plan allows ${limits.investorEmails} total emails.`,
      entitlementTier,
      investorLimit: limits.investorEmails,
    });
  }

  const userRow = (await pool.query("SELECT * FROM users WHERE id = $1", [userId])).rows[0];

  const sentTodayResult = await pool.query(
    `SELECT COUNT(*)::int AS count FROM email_sends
     WHERE user_id = $1 AND status = 'SENT' AND sent_at >= date_trunc('day', now())`,
    [userId]
  );
  const bounceResult = await pool.query(
    `SELECT COUNT(*)::int AS count FROM email_sends
     WHERE user_id = $1 AND status = 'BOUNCED' AND bounced_at >= now() - interval '7 days'`,
    [userId]
  );

  const state: UserSendState = {
    accountAgeDays: userRow.gmail_connected_at
      ? Math.floor((Date.now() - new Date(userRow.gmail_connected_at).getTime()) / 86_400_000)
      : 0,
    sendReputationScore: userRow.send_reputation_score,
    sentTodayCount: sentTodayResult.rows[0].count,
    bounceCountLast7Days: bounceResult.rows[0].count,
    complaintCountLast7Days: userRow.complaint_reported_at
      ? new Date(userRow.complaint_reported_at).getTime() > Date.now() - 7 * 86_400_000
        ? 1
        : 0
      : 0,
  };

  const decision = evaluateSend(state);
  if (!decision.allowed) {
    return res.status(429).json({ error: decision.reason, dailyCap: decision.dailyCap });
  }

  const hasGmailConnection = !!userRow.google_refresh_token;
  const smtpFallbackAllowed = process.env.NODE_ENV !== "production" && process.env.SMTP_FALLBACK_ENABLED === "true";
  const canSendAtAll = hasGmailConnection || smtpFallbackAllowed;
  if (!canSendAtAll) {
    return res.status(400).json({
      error: "Connect Gmail before dispatching sends.",
    });
  }

  const queuedResult = await pool.query(
    `SELECT es.*, i.email AS investor_email FROM email_sends es
     JOIN investors i ON i.id = es.investor_id
     WHERE es.campaign_id = $1 AND es.status = 'QUEUED'
     ORDER BY es.match_score DESC LIMIT $2`,
    [campaign.id, decision.remainingToday]
  );

  if (queuedResult.rows.length === 0) {
    return res.json({ dispatched: 0, message: "No queued sends remaining for this campaign." });
  }

  const dispatched: string[] = [];
  const failed: { id: string; error: string }[] = [];

  for (const send of queuedResult.rows) {
    const result = await deliverEmail(
      userId,
      { to: send.investor_email, subject: send.subject, body: send.body_text, fromName: userRow.name },
      hasGmailConnection ? userRow.connected_gmail_address || userRow.email : null
    );

    if (result.delivered) {
      await pool.query(
        `UPDATE email_sends SET status = 'SENT', sent_at = now(), gmail_message_id = $1, gmail_thread_id = $2 WHERE id = $3`,
        [result.messageId ?? null, result.threadId ?? null, send.id]
      );
      await pool.query(
        "UPDATE users SET send_reputation_score = LEAST(1.0, send_reputation_score + 0.01) WHERE id = $1",
        [userId]
      );
      dispatched.push(send.id);
    } else {
      await pool.query(`UPDATE email_sends SET status = 'FAILED' WHERE id = $1`, [send.id]);
      failed.push({ id: send.id, error: result.error ?? "Unknown delivery failure." });
    }
  }

  if (dispatched.length > 0) {
    await createNotification(
      userId,
      "send_dispatched",
      `${dispatched.length} outreach emails sent`,
      failed.length > 0 ? `${failed.length} failed to send — check details.` : undefined
    );
  }

  res.json({
    dispatched: dispatched.length,
    failed: failed.length,
    failures: failed,
    remainingCapToday: decision.remainingToday - dispatched.length,
  });
});

/**
 * Marks a send as bounced or a complaint, using the real classifier in
 * bounceClassifier.ts. Called by whatever inbound-message watcher you wire up (Gmail API
 * `users.watch` + Pub/Sub push, or a simpler polling job checking the founder's inbox for
 * delivery-failure notices) — this route is the classification + DB-update endpoint that
 * watcher calls into; it doesn't itself connect to Gmail's push notification service.
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

  // hard_bounce or soft_bounce: try to identify which send this refers to
  const recipientEmail = bodyText ? extractBouncedRecipient(bodyText) : null;
  if (recipientEmail) {
    const matchingSend = await pool.query(
      `SELECT es.id FROM email_sends es JOIN investors i ON i.id = es.investor_id
       WHERE es.user_id = $1 AND i.email = $2 AND es.status = 'SENT'
       ORDER BY es.sent_at DESC LIMIT 1`,
      [userId, recipientEmail]
    );
    if (matchingSend.rows.length > 0) {
      await pool.query("UPDATE email_sends SET status = 'BOUNCED', bounced_at = now() WHERE id = $1", [
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

/** Manual override — lets a founder or admin flag a bounce directly if the automatic
 * classifier above isn't wired to a live inbox watcher yet. */
sendRouter.post("/:sendId/bounce", async (req, res) => {
  const userId = req.auth!.userId;
  const send = (
    await pool.query("SELECT * FROM email_sends WHERE id = $1 AND user_id = $2", [req.params.sendId, userId])
  ).rows[0];
  if (!send) return res.status(404).json({ error: "Send not found." });

  await pool.query("UPDATE email_sends SET status = 'BOUNCED', bounced_at = now() WHERE id = $1", [send.id]);
  const currentScore = (await pool.query("SELECT send_reputation_score FROM users WHERE id = $1", [userId])).rows[0]
    .send_reputation_score;
  const newScore = applyReputationEvent(currentScore, "bounce");
  await pool.query("UPDATE users SET send_reputation_score = $1 WHERE id = $2", [newScore, userId]);
  res.json({ ok: true });
});
