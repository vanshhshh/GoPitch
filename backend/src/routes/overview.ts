import { Router } from "express";
import { pool } from "../lib/db";
import { requireAuth } from "../lib/auth";
import { loadProfile, ProfileError, resolveCompanyId } from "../services/companyProfileService";
import { rankForCompany } from "../services/matchingContext";
import { fundKey } from "../services/matchingService";
import { loadEntitlement } from "../services/entitlementService";
import { userHasReplyTrackingScope } from "./googleAuth";
import { sendingCapacity } from "./sends";

export const overviewRouter = Router();
overviewRouter.use(requireAuth);

export interface OverviewState {
  hasCompany: boolean;
  onboardingComplete: boolean;
  profileMatchable: boolean;
  totalMatches: number;
  nextCampaignSize: number;
  quotaExhausted: boolean;
  gmailConnected: boolean;
  draftCampaignId: string | null;
  activeCampaign: { id: string; queued: number } | null;
  recentReplies: number;
  remainingToday: number;
  missingSection: string | null;
}

export interface NextAction {
  key: string;
  title: string;
  description: string;
  href: string;
  cta: string;
}

/** The single most useful next step, in fundraising-journey order. Pure for testability. */
export function nextAction(s: OverviewState): NextAction {
  if (!s.hasCompany || !s.onboardingComplete) {
    return { key: "continue_profile", title: "Finish your company profile", description: "Matching quality depends on it — it takes about 10 minutes and saves as you go.", href: "/onboarding", cta: "Continue profile" };
  }
  if (!s.profileMatchable) {
    return { key: "complete_profile", title: "Add your stage and industry", description: "Investor matching needs your funding stage and industry.", href: `/dashboard/company?section=${s.missingSection ?? "fundraising"}`, cta: "Update profile" };
  }
  if (s.recentReplies > 0) {
    return { key: "review_replies", title: `${s.recentReplies} investor ${s.recentReplies === 1 ? "reply" : "replies"} to follow up`, description: "Replies detected in your Gmail threads in the last 14 days.", href: "/dashboard/outreach?tab=activity&status=REPLIED", cta: "Review replies" };
  }
  if (s.draftCampaignId) {
    return { key: "review_draft", title: "Review and launch your draft campaign", description: "Check each email, edit anything you like, then launch.", href: `/dashboard/outreach/campaigns/${s.draftCampaignId}`, cta: "Review drafts" };
  }
  if (s.activeCampaign && s.activeCampaign.queued > 0) {
    if (!s.gmailConnected) {
      return { key: "connect_gmail", title: "Connect Gmail to start sending", description: "Emails send from your own Gmail. Drafts stay queued until you connect.", href: "/dashboard/settings?tab=gmail", cta: "Connect Gmail" };
    }
    if (s.quotaExhausted) {
      return { key: "upgrade", title: "Your plan's email allowance is used up", description: "Upgrade to keep sending the emails still queued.", href: "/dashboard/billing", cta: "See plans" };
    }
    if (s.remainingToday > 0) {
      return { key: "send_batch", title: `Send the next ${Math.min(s.activeCampaign.queued, s.remainingToday)} emails`, description: "Within today's warm-up limit for your Gmail account.", href: `/dashboard/outreach/campaigns/${s.activeCampaign.id}`, cta: "Open campaign" };
    }
    return { key: "monitor", title: "Daily sending limit reached", description: "Your next batch can go out after the daily reset. Monitor replies meanwhile.", href: `/dashboard/outreach/campaigns/${s.activeCampaign.id}`, cta: "Monitor outreach" };
  }
  if (s.totalMatches > 0 && s.nextCampaignSize > 0) {
    return { key: "review_investors", title: `Review your ${s.totalMatches} investor matches`, description: "Save the best fits, exclude the rest, and start a campaign.", href: "/dashboard/investors", cta: "Review investors" };
  }
  if (s.quotaExhausted) {
    return { key: "upgrade", title: "Reach more investors", description: "You've used your plan's email allowance.", href: "/dashboard/billing", cta: "See plans" };
  }
  if (s.totalMatches === 0) {
    return { key: "improve_matches", title: "No investor matches yet", description: "Broaden your sectors, sub-industries or target geographies to find relevant funds.", href: "/dashboard/company?section=overview", cta: "Refine profile" };
  }
  return { key: "monitor", title: "All matched investors contacted", description: "Track replies and outcomes in Analytics.", href: "/dashboard/analytics", cta: "View analytics" };
}

const SECTION_FOR: Record<string, string> = { founders: "founders", overview: "overview", productMarket: "product", traction: "traction", fundraising: "fundraising", preferences: "preferences", documents: "documents" };

overviewRouter.get("/", async (req, res) => {
  const userId = req.auth!.userId;
  try {
    const user = (await pool.query("SELECT name, email, google_refresh_token, gmail_granted_scopes FROM users WHERE id = $1", [userId])).rows[0];
    const companyId = await resolveCompanyId(userId, (req.query.companyId as string) || null);
    const entitlement = await loadEntitlement(userId);
    const gmailConnected = !!user?.google_refresh_token;

    if (!companyId) {
      const state: OverviewState = { hasCompany: false, onboardingComplete: false, profileMatchable: false, totalMatches: 0, nextCampaignSize: 0, quotaExhausted: false, gmailConnected, draftCampaignId: null, activeCampaign: null, recentReplies: 0, remainingToday: 0, missingSection: null };
      return res.json({ user: { name: user?.name ?? null }, company: null, nextAction: nextAction(state), journey: journey(state, 0, 0) });
    }

    const profile = await loadProfile(companyId, userId);
    const r = await rankForCompany(userId, companyId);
    const matchable = !!r && r !== "incomplete";
    const totalMatches = matchable ? r.ranked.length : 0;
    const fresh = matchable ? r.ranked.filter((m) => !r.alreadyContacted.has(m.investorId)).length : 0;

    const campaigns = (
      await pool.query(
        `SELECT c.id, c.status, c.name, COUNT(es.id) FILTER (WHERE es.status = 'QUEUED')::int AS queued
         FROM campaigns c LEFT JOIN email_sends es ON es.campaign_id = c.id
         WHERE c.user_id = $1 AND c.company_id = $2 GROUP BY c.id ORDER BY c.created_at DESC`,
        [userId, companyId]
      )
    ).rows;
    const counts = (
      await pool.query(
        `SELECT COUNT(*) FILTER (WHERE es.sent_at IS NOT NULL)::int AS sent, COUNT(*) FILTER (WHERE es.status = 'QUEUED')::int AS queued,
                COUNT(*) FILTER (WHERE es.status = 'REPLIED')::int AS replied, COUNT(*) FILTER (WHERE es.status = 'BOUNCED')::int AS bounced,
                COUNT(*) FILTER (WHERE es.status = 'FAILED')::int AS failed,
                COUNT(*) FILTER (WHERE es.status = 'REPLIED' AND es.replied_at > now() - interval '14 days')::int AS recent_replies
         FROM email_sends es JOIN campaigns c ON c.id = es.campaign_id WHERE es.user_id = $1 AND c.company_id = $2`,
        [userId, companyId]
      )
    ).rows[0];
    const saved = (await pool.query("SELECT COUNT(*)::int AS n FROM company_investor_lists WHERE company_id = $1 AND list = 'SAVED'", [companyId])).rows[0].n;
    const activity = (
      await pool.query(
        `SELECT es.status, es.sent_at, es.replied_at, es.bounced_at, es.campaign_id, i.id AS investor_id, i.name, i.firm
         FROM email_sends es JOIN investors i ON i.id = es.investor_id JOIN campaigns c ON c.id = es.campaign_id
         WHERE es.user_id = $1 AND c.company_id = $2 AND es.sent_at IS NOT NULL
         ORDER BY GREATEST(es.sent_at, COALESCE(es.replied_at, es.sent_at), COALESCE(es.bounced_at, es.sent_at)) DESC LIMIT 8`,
        [userId, companyId]
      )
    ).rows;
    const subscription = (await pool.query("SELECT current_period_end, cancel_at_period_end FROM subscriptions WHERE user_id = $1", [userId])).rows[0];

    const active = campaigns.find((c) => c.status === "ACTIVE") ?? null;
    const draft = campaigns.find((c) => c.status === "DRAFT") ?? null;
    const capacity = await sendingCapacity(userId);
    const remainingToday = capacity.allowed ? capacity.remainingToday : 0;
    const missingRequired = profile.completeness.missingRequired;
    const state: OverviewState = {
      hasCompany: true,
      onboardingComplete: !!profile.onboarding.completedAt,
      profileMatchable: matchable,
      totalMatches,
      nextCampaignSize: Math.min(fresh, entitlement.quota.remainingToAllocate),
      quotaExhausted: entitlement.quota.exhausted,
      gmailConnected,
      draftCampaignId: draft?.id ?? null,
      activeCampaign: active ? { id: active.id, queued: active.queued } : null,
      recentReplies: counts.recent_replies,
      remainingToday,
      missingSection: missingRequired[0] ? SECTION_FOR[missingRequired[0].section] ?? null : null,
    };

    const alerts: { tone: "danger" | "signal"; text: string; href: string }[] = [];
    if (!gmailConnected && campaigns.some((c) => c.queued > 0 && c.status !== "DRAFT")) alerts.push({ tone: "danger", text: "Gmail isn't connected — queued emails can't send.", href: "/dashboard/settings?tab=gmail" });
    if (entitlement.quota.exhausted) alerts.push({ tone: "danger", text: `You've used all ${entitlement.quota.limit} emails in your plan.`, href: "/dashboard/billing" });
    if (counts.failed > 0) alerts.push({ tone: "signal", text: `${counts.failed} email${counts.failed === 1 ? "" : "s"} failed to send.`, href: "/dashboard/outreach?tab=activity&status=FAILED" });
    if (subscription?.current_period_end && entitlement.tier !== "FREE") {
      const days = (new Date(subscription.current_period_end).getTime() - Date.now()) / 86_400_000;
      if (days > 0 && days < 7) alerts.push({ tone: "signal", text: `Your plan ends in ${Math.ceil(days)} day${days < 2 ? "" : "s"}.`, href: "/dashboard/billing" });
    }
    if (gmailConnected && !userHasReplyTrackingScope(user.gmail_granted_scopes)) alerts.push({ tone: "signal", text: "Reply tracking is off for your Gmail connection.", href: "/dashboard/settings?tab=gmail" });

    res.json({
      user: { name: user?.name ?? null },
      company: { id: companyId, name: profile.overview.name, oneLiner: profile.overview.oneLiner },
      profile: {
        percent: profile.completeness.percent,
        onboardingComplete: state.onboardingComplete,
        intelligenceStatus: profile.intelligence?.status ?? null,
        suggestions: [...missingRequired, ...profile.completeness.missingOptional].slice(0, 5).map((m) => ({
          label: m.label,
          required: m.required,
          href: `/dashboard/company?section=${SECTION_FOR[m.section] ?? "overview"}&field=${m.field}`,
        })),
      },
      matches: {
        total: totalMatches,
        funds: matchable ? new Set(r.ranked.map((m) => fundKey(r.investors.get(m.investorId)!.firm))).size : 0,
        notYetContacted: fresh,
        nextCampaignSize: state.nextCampaignSize,
        saved,
        incomplete: r === "incomplete",
      },
      plan: { tier: entitlement.tier, limit: entitlement.quota.limit, sent: entitlement.quota.sent, remainingToSend: entitlement.quota.remainingToSend, remainingToAllocate: entitlement.quota.remainingToAllocate },
      outreach: {
        campaigns: { draft: campaigns.filter((c) => c.status === "DRAFT").length, active: campaigns.filter((c) => c.status === "ACTIVE" || c.status === "PAUSED").length, completed: campaigns.filter((c) => c.status === "COMPLETED").length },
        sent: counts.sent,
        queued: counts.queued,
        replied: counts.replied,
        bounced: counts.bounced,
        failed: counts.failed,
      },
      gmail: { connected: gmailConnected, replyTracking: userHasReplyTrackingScope(user?.gmail_granted_scopes) },
      activity: activity.map((a) => ({
        kind: a.status === "REPLIED" ? "replied" : a.status === "BOUNCED" ? "bounced" : "sent",
        at: a.replied_at ?? a.bounced_at ?? a.sent_at,
        investorId: a.investor_id,
        investorName: a.name,
        firm: a.firm,
        campaignId: a.campaign_id,
      })),
      alerts,
      nextAction: nextAction(state),
      journey: journey(state, saved, campaigns.length),
    });
  } catch (err) {
    if (err instanceof ProfileError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});

function journey(s: OverviewState, saved: number, campaignCount: number) {
  const steps = [
    { key: "profile", label: "Company profile", done: s.onboardingComplete, href: "/dashboard/company" },
    { key: "discover", label: "Investor matches", done: s.totalMatches > 0, href: "/dashboard/investors" },
    { key: "select", label: "Select investors", done: saved > 0 || campaignCount > 0, href: "/dashboard/investors?list=saved" },
    { key: "outreach", label: "Launch outreach", done: !!s.activeCampaign || campaignCount > (s.draftCampaignId ? 1 : 0), href: "/dashboard/outreach" },
    { key: "conversations", label: "Investor conversations", done: s.recentReplies > 0, href: "/dashboard/outreach?tab=activity&status=REPLIED" },
  ];
  const current = steps.findIndex((x) => !x.done);
  return steps.map((x, i) => ({ ...x, state: x.done ? "done" : i === current ? "current" : "upcoming" }));
}
