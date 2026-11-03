"use client";

import { useState } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { api, errorMessage, startGmailConnect } from "@/lib/api";
import { ScorePill, StatusBadge } from "@/components/ui";

export interface Quota {
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

export interface SendRow {
  id: string;
  investorId: string;
  investorName: string;
  investorFirm: string;
  investorTitle?: string | null;
  fundKey?: string;
  subject: string;
  bodyText: string;
  matchScore: number;
  status: string;
  failureReason: string | null;
  sentAt: string | null;
  repliedAt?: string | null;
  bouncedAt?: string | null;
}

/** Plan allowance, warm-up and Gmail state in one place — shown wherever sending happens. */
export function SendingConfig({ quota, returnTo }: { quota: Quota; returnTo: string }) {
  const [connecting, setConnecting] = useState(false);
  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="label">Gmail</span>
        {quota.gmailConnected ? (
          <span className="text-verified">Connected</span>
        ) : (
          <button
            className="btn-primary text-xs"
            disabled={connecting}
            onClick={async () => {
              setConnecting(true);
              try {
                await startGmailConnect(returnTo);
              } catch (err) {
                toast.error(errorMessage(err, "Couldn't start Gmail connection."));
                setConnecting(false);
              }
            }}
          >
            {connecting ? "Redirecting…" : "Connect Gmail"}
          </button>
        )}
      </div>
      <Row label="Plan allowance" value={`${quota.investorEmailsRemaining} of ${quota.investorEmailsTotal} left`} danger={quota.quotaExhausted} />
      <Row label="Today" value={`${quota.sentToday} sent · ${quota.remainingToday} left of ${quota.currentDailyLimit}`} />
      <p className="text-xs text-ink-soft">
        {!quota.gmailConnected
          ? `Warm-up starts when Gmail is connected: ${quota.warmupDailyLimit}/day for ${quota.warmupDays} days, then ${quota.postWarmupDailyLimit}/day.`
          : quota.warmupComplete
            ? `Warm-up complete — up to ${quota.postWarmupDailyLimit}/day.`
            : `Warm-up day ${quota.warmupDay} of ${quota.warmupDays}: ${quota.warmupDailyLimit}/day, then ${quota.postWarmupDailyLimit}/day.`}{" "}
        Resets {new Date(quota.dailyResetsAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}.
      </p>
      {quota.sendingPausedReason && <p className="text-xs text-danger">{quota.sendingPausedReason}</p>}
      {quota.quotaExhausted && (
        <Link href="/dashboard/billing" className="text-xs text-danger underline">
          Plan allowance used — upgrade to keep sending
        </Link>
      )}
    </div>
  );
}

function Row({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="label">{label}</span>
      <span className={`font-mono text-xs ${danger ? "text-danger" : "text-ink"}`}>{value}</span>
    </div>
  );
}

/** One email: read-only once sent; editable (and removable) while queued. */
export function EmailCard({ send, campaignId, editable, onChanged }: { send: SendRow; campaignId: string; editable: boolean; onChanged: () => void }) {
  const [subject, setSubject] = useState(send.subject);
  const [body, setBody] = useState(send.bodyText);
  const [saved, setSaved] = useState({ subject: send.subject, body: send.bodyText });
  const [busy, setBusy] = useState(false);
  const dirty = subject !== saved.subject || body !== saved.body;
  const canEdit = editable && send.status === "QUEUED";

  async function save() {
    setBusy(true);
    try {
      const r = await api.patch<{ subject: string; bodyText: string }>(`/api/sends/${send.id}`, { subject, bodyText: body });
      setSaved({ subject: r.subject, body: r.bodyText });
      setSubject(r.subject);
      toast.success("Draft saved.");
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't save the draft."));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api.delete(`/api/campaigns/${campaignId}/drafts/${send.id}`);
      toast.success(`${send.investorName} removed from this campaign.`);
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't remove."));
      setBusy(false);
    }
  }

  return (
    <details className="card">
      <summary className="flex items-center justify-between gap-3 cursor-pointer list-none p-4">
        <span className="flex items-center gap-3 min-w-0">
          <ScorePill score={send.matchScore} />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-navy truncate">{send.investorName}</span>
            <span className="block text-xs text-ink-soft truncate">
              {send.investorFirm.trim()} — {saved.subject}
            </span>
          </span>
        </span>
        <StatusBadge status={send.status} />
      </summary>
      <div className="border-t border-line-soft p-4 space-y-3">
        <div className="flex flex-wrap gap-3 text-xs">
          <Link href={`/dashboard/investors/people/${send.investorId}`} className="text-verified hover:underline">
            Investor profile
          </Link>
          {send.fundKey && (
            <Link href={`/dashboard/investors/funds/${encodeURIComponent(send.fundKey)}`} className="text-verified hover:underline">
              Fund
            </Link>
          )}
        </div>
        {send.failureReason && <p className="text-xs text-danger">Failed: {send.failureReason}</p>}
        {canEdit ? (
          <>
            <label className="block">
              <span className="label block mb-1">Subject</span>
              <input className="input-field" maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} />
            </label>
            <label className="block">
              <span className="label block mb-1">Email</span>
              <textarea className="input-field" rows={8} maxLength={10000} value={body} onChange={(e) => setBody(e.target.value)} />
            </label>
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary text-xs" onClick={save} disabled={!dirty || busy || !subject.trim() || !body.trim()}>
                {busy ? "Saving…" : "Save draft"}
              </button>
              {dirty && (
                <button className="btn-ghost text-xs" onClick={() => (setSubject(saved.subject), setBody(saved.body))}>
                  Discard changes
                </button>
              )}
              <button className="btn-ghost text-xs text-danger ml-auto inline-flex items-center gap-1" onClick={remove} disabled={busy}>
                <Trash2 size={12} aria-hidden /> Remove from campaign
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm font-medium">{saved.subject}</p>
            <p className="text-sm whitespace-pre-line text-ink">{saved.body}</p>
            {send.sentAt && <p className="text-xs text-ink-soft">Sent {new Date(send.sentAt).toLocaleString()}</p>}
          </>
        )}
      </div>
    </details>
  );
}
