"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { api, ApiError } from "@/lib/api";

interface Campaign {
  id: string;
  companyId: string;
  companyName: string;
  tier: string;
  matchedInvestorCount: number;
  status: string;
  createdAt: string;
}

interface QuotaInfo {
  entitlementTier: string;
  investorEmailsTotal: number;
  investorEmailsSent: number;
  investorEmailsRemaining: number | null;
  queuedEmails: number;
  dailySendLimit: number;
  warmupDailyLimit: number;
  postWarmupDailyLimit: number;
  currentDailyLimit: number;
  sentToday: number;
  remainingToday: number;
  accountAgeDays: number;
  warmupCap: number;
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [dispatching, setDispatching] = useState<string | null>(null);
  const [gmailConnected, setGmailConnected] = useState<boolean | null>(null);
  const [quota, setQuota] = useState<QuotaInfo | null>(null);

  function refresh() {
    api.get<Campaign[]>("/api/campaigns").then(setCampaigns).catch(() => toast.error("Couldn't load campaigns."));
  }

  useEffect(() => {
    refresh();
    api.get<{ gmailConnected: boolean }>("/api/profile/me").then((p) => setGmailConnected(p.gmailConnected)).catch(() => {});
    api.get<QuotaInfo>("/api/sends/quota").then(setQuota).catch(() => {});
  }, []);

  function connectGmail() {
    const token = localStorage.getItem("gopitch_token");
    const apiBase = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:4000";
    window.location.href = `${apiBase}/auth/google/init?token=${token}`;
  }

  async function dispatch(campaignId: string) {
    setDispatching(campaignId);
    try {
      const res = await api.post<{ dispatched: number; failed: number; error?: string }>(
        `/api/sends/campaigns/${campaignId}/dispatch`
      );
      if (res.dispatched > 0) {
        toast.success(`${res.dispatched} email${res.dispatched === 1 ? "" : "s"} sent.`);
      } else {
        toast(res.error || "Nothing left to send right now.");
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Dispatch failed.");
    } finally {
      setDispatching(null);
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-8 py-10">
      <h1 className="font-display text-2xl mb-1">Campaigns</h1>
      <p className="text-ink-soft text-sm mb-6">Every outreach campaign across all your raises.</p>

      {gmailConnected === false && (
        <div className="card p-4 mb-6 flex items-center justify-between bg-signal-soft/40 border-signal/20">
          <p className="text-sm text-ink-soft">Connect Gmail to enable sending campaigns.</p>
          <button className="btn-primary text-sm" onClick={connectGmail}>
            Connect Gmail
          </button>
        </div>
      )}

      {quota && (
        <div className="card p-5 mb-6 animate-fade-up">
          <h3 className="font-display text-lg mb-3">Campaign Email Capacity</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-xs text-ink-soft mb-1">Sent</p>
              <p className="font-mono text-lg">{quota.investorEmailsSent}</p>
            </div>
            <div>
              <p className="text-xs text-ink-soft mb-1">Remaining</p>
              <p className="font-mono text-lg">{quota.investorEmailsRemaining ?? "∞"}</p>
            </div>
            <div>
              <p className="text-xs text-ink-soft mb-1">Current daily limit</p>
              <p className="font-mono text-lg">{quota.currentDailyLimit}/day</p>
            </div>
            <div>
              <p className="text-xs text-ink-soft mb-1">After warmup</p>
              <p className="font-mono text-lg">{quota.postWarmupDailyLimit}/day</p>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-line-soft">
            <p className="text-xs text-ink-soft">
              Warmup: Day {quota.accountAgeDays} of 21 · Current cap {quota.warmupCap}/day · Today sent {quota.sentToday} · Remaining today {quota.remainingToday}
            </p>
          </div>
        </div>
      )}

      {campaigns === null ? (
        <p className="text-ink-soft text-sm">Loading…</p>
      ) : campaigns.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-ink-soft text-sm mb-4">No campaigns yet. Find matched investors from a company page first.</p>
          <Link href="/dashboard" className="btn-primary inline-block">
            Go to your raises
          </Link>
        </div>
      ) : (
        <div className="card divide-y divide-line-soft animate-fade-up">
          {campaigns.map((c) => (
            <div key={c.id} className="p-5 flex items-center justify-between">
              <div>
                <Link href={`/company/${c.companyId}`} className="font-medium text-sm hover:text-verified transition-colors">
                  {c.companyName}
                </Link>
                <p className="text-xs text-ink-soft mt-0.5">
                  {c.tier} · {c.matchedInvestorCount} matched investors · {new Date(c.createdAt).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[10px] uppercase tracking-wide text-ink-soft bg-line-soft px-2 py-0.5 rounded">
                  {c.status}
                </span>
                <button
                  className="btn-secondary text-xs"
                  onClick={() => dispatch(c.id)}
                  disabled={dispatching === c.id || gmailConnected === false}
                  title={gmailConnected === false ? "Connect Gmail first" : undefined}
                >
                  {dispatching === c.id ? "Sending…" : "Send next batch"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
