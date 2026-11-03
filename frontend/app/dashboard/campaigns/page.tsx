"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { api, ApiError, errorMessage, startGmailConnect } from "@/lib/api";
import { announceQuotaExhausted } from "@/lib/events";

interface Campaign {
  id: string;
  companyId: string;
  companyName: string;
  tier: string;
  matchedInvestorCount: number;
  status: "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELLED";
  createdAt: string;
  counts: { total: number; queued: number; sent: number; failed: number; bounced: number; replied: number };
}

interface QuotaInfo {
  entitlementTier: string;
  investorEmailsTotal: number;
  investorEmailsSent: number;
  investorEmailsQueued: number;
  investorEmailsRemaining: number;
  quotaExhausted: boolean;
  currentDailyLimit: number;
  sentToday: number;
  remainingToday: number;
  sendingPausedReason: string | null;
  dailyResetsAt: string;
  warmupDays: number;
  warmupDay: number | null;
  warmupComplete: boolean;
  warmupDailyLimit: number;
  postWarmupDailyLimit: number;
  gmailConnected: boolean;
}

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: "bg-verified-soft text-verified",
  PAUSED: "bg-signal-soft text-signal",
  COMPLETED: "bg-line-soft text-ink-soft",
  CANCELLED: "bg-line-soft text-ink-soft line-through",
};

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api
      .get<Campaign[]>("/api/campaigns")
      .then((c) => (setCampaigns(c), setLoadError(null)))
      .catch((err) => setLoadError(errorMessage(err, "Couldn't load campaigns.")));
    api.get<QuotaInfo>("/api/sends/quota").then(setQuota).catch(() => {});
  }, []);

  useEffect(refresh, [refresh]);

  async function connectGmail() {
    setConnecting(true);
    try {
      await startGmailConnect("/dashboard/campaigns");
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't start Gmail connection."));
      setConnecting(false);
    }
  }

  async function dispatch(campaignId: string) {
    setBusy(campaignId);
    try {
      const res = await api.post<{ dispatched: number; failed: number; stoppedReason?: string | null; message?: string; remainingQuota?: number }>(
        `/api/sends/campaigns/${campaignId}/dispatch`
      );
      if (res.dispatched > 0) toast.success(`${res.dispatched} email${res.dispatched === 1 ? "" : "s"} sent${res.failed ? `, ${res.failed} failed` : ""}.`);
      else if (res.failed > 0) toast.error(`${res.failed} email${res.failed === 1 ? "" : "s"} failed to send.`);
      else toast(res.message || "Nothing left to send for this campaign.");
      if (res.stoppedReason) toast.error(res.stoppedReason, { duration: 8000 });
      if (res.remainingQuota === 0) announceQuotaExhausted({ tier: quota?.entitlementTier, limit: quota?.investorEmailsTotal });
    } catch (err) {
      toast.error(errorMessage(err, "Sending failed."));
      if (err instanceof ApiError && err.body?.upgradeRequired) announceQuotaExhausted({ tier: err.body.entitlementTier, limit: err.body.investorLimit });
    } finally {
      setBusy(null);
      refresh();
    }
  }

  async function changeStatus(campaignId: string, action: "pause" | "resume" | "cancel") {
    setBusy(campaignId);
    try {
      const res = await api.post<{ cancelledSends?: number }>(`/api/campaigns/${campaignId}/status`, { action });
      toast.success(
        action === "cancel" ? `Campaign cancelled. ${res.cancelledSends ?? 0} unsent drafts released back to your allowance.` : action === "pause" ? "Campaign paused." : "Campaign resumed."
      );
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't update the campaign."));
    } finally {
      setBusy(null);
      setConfirmCancel(null);
      refresh();
    }
  }

  async function retryFailed(campaignId: string) {
    setBusy(campaignId);
    try {
      const res = await api.post<{ requeued: number }>(`/api/campaigns/${campaignId}/retry-failed`);
      toast.success(`${res.requeued} failed email${res.requeued === 1 ? "" : "s"} queued again.`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't retry."));
    } finally {
      setBusy(null);
      refresh();
    }
  }

  const canSend = !!quota?.gmailConnected && !quota.quotaExhausted && quota.remainingToday > 0;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-8 py-10">
      <h1 className="font-display text-2xl mb-1">Campaigns</h1>
      <p className="text-ink-soft text-sm mb-6">Every outreach campaign across your raises. Emails send from your own Gmail, in batches within your daily limit.</p>

      {quota && !quota.gmailConnected && (
        <div className="card p-4 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-signal-soft/40 border-signal/20">
          <p className="text-sm text-ink-soft">Connect Gmail to send. Drafts stay queued until you do.</p>
          <button className="btn-primary text-sm" onClick={connectGmail} disabled={connecting}>
            {connecting ? "Redirecting…" : "Connect Gmail"}
          </button>
        </div>
      )}

      {quota && (
        <div className="card p-5 mb-6 animate-fade-up">
          <div className="flex items-baseline justify-between mb-3 gap-2">
            <h2 className="font-display text-lg">Sending capacity</h2>
            <Link href="/dashboard/billing" className="text-xs text-verified hover:underline">
              {quota.entitlementTier === "FREE" ? "Free plan · upgrade" : `${quota.entitlementTier} plan`}
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <Metric label="Sent (plan)" value={`${quota.investorEmailsSent} / ${quota.investorEmailsTotal}`} />
            <Metric label="Queued" value={quota.investorEmailsQueued} />
            <Metric label="Left to send (plan)" value={quota.investorEmailsRemaining} />
            <Metric label="Left today" value={`${quota.remainingToday} / ${quota.currentDailyLimit}`} />
          </div>
          <p className="text-xs text-ink-soft mt-4 pt-4 border-t border-line-soft">
            {!quota.gmailConnected
              ? `Warm-up starts when you connect Gmail: ${quota.warmupDailyLimit}/day for ${quota.warmupDays} days, then ${quota.postWarmupDailyLimit}/day.`
              : quota.warmupComplete
                ? `Warm-up complete · ${quota.postWarmupDailyLimit}/day.`
                : `Warm-up day ${quota.warmupDay} of ${quota.warmupDays} · ${quota.warmupDailyLimit}/day, rising to ${quota.postWarmupDailyLimit}/day after warm-up.`}{" "}
            Sent today: {quota.sentToday}. Daily count resets {new Date(quota.dailyResetsAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}.
          </p>
          {quota.sendingPausedReason && <p className="text-xs text-danger mt-2">{quota.sendingPausedReason}</p>}
          {quota.quotaExhausted && (
            <p className="text-xs text-danger mt-2">
              You've used every email in your plan.{" "}
              <Link href="/dashboard/billing" className="underline">
                Upgrade to keep sending
              </Link>
              .
            </p>
          )}
        </div>
      )}

      {loadError ? (
        <div className="card p-6 text-sm">
          <p className="text-danger mb-3">{loadError}</p>
          <button className="btn-secondary" onClick={refresh}>
            Retry
          </button>
        </div>
      ) : campaigns === null ? (
        <p className="text-ink-soft text-sm">Loading…</p>
      ) : campaigns.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-ink-soft text-sm mb-4">No campaigns yet. Open one of your raises and start a campaign from its investor matches.</p>
          <Link href="/dashboard" className="btn-primary inline-block">
            Go to your raises
          </Link>
        </div>
      ) : (
        <div className="card divide-y divide-line-soft animate-fade-up">
          {campaigns.map((c) => {
            const isBusy = busy === c.id;
            const progress = c.counts.total ? Math.round((c.counts.sent / c.counts.total) * 100) : 0;
            return (
              <div key={c.id} className="p-5">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/company/${c.companyId}`} className="font-medium text-sm hover:text-verified transition-colors">
                      {c.companyName}
                    </Link>
                    <p className="text-xs text-ink-soft mt-0.5">
                      {c.tier} plan · {c.counts.total} investors selected · created {new Date(c.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <span className={`self-start text-[10px] uppercase tracking-wide px-2 py-0.5 rounded ${STATUS_STYLE[c.status] || ""}`}>{c.status}</span>
                </div>

                <div className="mt-3 h-1.5 bg-line-soft rounded-full overflow-hidden" aria-hidden>
                  <div className="h-full bg-verified" style={{ width: `${progress}%` }} />
                </div>
                <p className="text-xs text-ink-soft mt-2 font-mono">
                  {c.counts.sent} sent · {c.counts.queued} queued · {c.counts.failed} failed · {c.counts.bounced} bounced · {c.counts.replied} replied
                </p>

                <div className="flex flex-wrap gap-2 mt-3">
                  {c.status === "ACTIVE" && c.counts.queued > 0 && (
                    <button
                      className="btn-primary text-xs"
                      onClick={() => dispatch(c.id)}
                      disabled={isBusy || !canSend}
                      title={!quota?.gmailConnected ? "Connect Gmail first" : quota?.quotaExhausted ? "Plan allowance used" : quota?.remainingToday === 0 ? "Daily limit reached" : undefined}
                    >
                      {isBusy ? "Sending…" : `Send next batch (${Math.min(c.counts.queued, quota?.remainingToday ?? 0, quota?.investorEmailsRemaining ?? 0)})`}
                    </button>
                  )}
                  {c.status === "ACTIVE" && (
                    <button className="btn-secondary text-xs" onClick={() => changeStatus(c.id, "pause")} disabled={isBusy}>
                      Pause
                    </button>
                  )}
                  {c.status === "PAUSED" && (
                    <button className="btn-primary text-xs" onClick={() => changeStatus(c.id, "resume")} disabled={isBusy}>
                      Resume
                    </button>
                  )}
                  {c.counts.failed > 0 && c.status !== "CANCELLED" && (
                    <button className="btn-secondary text-xs" onClick={() => retryFailed(c.id)} disabled={isBusy}>
                      Retry {c.counts.failed} failed
                    </button>
                  )}
                  <Link href={`/dashboard/outreach?campaignId=${c.id}`} className="btn-secondary text-xs">
                    View emails
                  </Link>
                  {(c.status === "ACTIVE" || c.status === "PAUSED") &&
                    (confirmCancel === c.id ? (
                      <span className="flex items-center gap-2 text-xs">
                        <span className="text-ink-soft">Cancel and release {c.counts.queued + c.counts.failed} unsent drafts?</span>
                        <button className="btn-secondary text-xs text-danger" onClick={() => changeStatus(c.id, "cancel")} disabled={isBusy}>
                          Yes, cancel
                        </button>
                        <button className="text-ink-soft hover:text-ink" onClick={() => setConfirmCancel(null)}>
                          No
                        </button>
                      </span>
                    ) : (
                      <button className="text-xs text-ink-soft hover:text-danger px-2" onClick={() => setConfirmCancel(c.id)} disabled={isBusy}>
                        Cancel campaign
                      </button>
                    ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-xs text-ink-soft mb-1">{label}</p>
      <p className="font-mono text-lg">{value}</p>
    </div>
  );
}
