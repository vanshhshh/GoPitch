"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface AdminAnalytics {
  sentByDay: { date: string; count: number }[];
  campaignsByTier: Record<string, number>;
  investorEnrichment: { total: number; needsEnrichment: number };
}

export default function AdminAnalyticsPage() {
  const [data, setData] = useState<AdminAnalytics | null>(null);

  useEffect(() => {
    api.get<AdminAnalytics>("/api/admin/analytics").then(setData);
  }, []);

  if (!data) {
    return (
      <div className="max-w-4xl mx-auto px-8 py-10">
        <p className="text-ink-soft text-sm">Loading…</p>
      </div>
    );
  }

  const maxDaily = Math.max(1, ...data.sentByDay.map((d) => d.count));
  const enrichedPct =
    data.investorEnrichment.total > 0
      ? Math.round(((data.investorEnrichment.total - data.investorEnrichment.needsEnrichment) / data.investorEnrichment.total) * 1000) / 10
      : 0;

  return (
    <div className="max-w-4xl mx-auto px-8 py-10">
      <h1 className="font-display text-2xl mb-1">Platform analytics</h1>
      <p className="text-ink-soft text-sm mb-8">Real aggregated data — no estimated figures.</p>

      <div className="grid sm:grid-cols-2 gap-4 mb-8">
        <div className="card p-5">
          <h3 className="font-display text-base mb-1">Investor database enrichment</h3>
          <p className="font-display text-3xl mb-1">{enrichedPct}%</p>
          <p className="text-xs text-ink-soft">
            {data.investorEnrichment.total - data.investorEnrichment.needsEnrichment} of{" "}
            {data.investorEnrichment.total} investors have real stage/sector/geography data and are
            eligible for matching.
          </p>
        </div>
        <div className="card p-5">
          <h3 className="font-display text-base mb-3">Campaigns by tier</h3>
          <div className="flex gap-6">
            {Object.entries(data.campaignsByTier).map(([tier, count]) => (
              <div key={tier}>
                <p className="font-mono text-xl">{count}</p>
                <p className="label">{tier}</p>
              </div>
            ))}
            {Object.keys(data.campaignsByTier).length === 0 && <p className="text-sm text-ink-soft">No campaigns yet.</p>}
          </div>
        </div>
      </div>

      <div className="card p-6">
        <h3 className="font-display text-base mb-4">Platform-wide sends, last 30 days</h3>
        {data.sentByDay.length === 0 ? (
          <p className="text-sm text-ink-soft">No sends dispatched in this window yet.</p>
        ) : (
          <div className="flex items-end gap-1 h-32">
            {data.sentByDay.map((d) => (
              <div
                key={d.date}
                className="flex-1 bg-verified rounded-t"
                style={{ height: `${(d.count / maxDaily) * 100}%`, minHeight: "2px" }}
                title={`${d.count} on ${new Date(d.date).toLocaleDateString()}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
