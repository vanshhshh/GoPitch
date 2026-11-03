"use client";

import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";

interface Analytics {
  sendsByStatus: Record<string, number>;
  totals: { drafted: number; sent: number; replied: number; bounced: number };
  replyTrackingEnabled: boolean;
  averageMatchScore: number | null;
  sentByDay: { date: string; count: number }[];
}

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 1000) / 10}%` : "—");

export default function AnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Analytics>("/api/sends/analytics").then(setData).catch((err) => setError(errorMessage(err, "Couldn't load analytics.")));
  }, []);

  if (error) return <div className="max-w-4xl mx-auto px-4 sm:px-8 py-10 text-sm text-danger">{error}</div>;
  if (!data) return <div className="max-w-4xl mx-auto px-4 sm:px-8 py-10 text-ink-soft text-sm">Loading…</div>;

  const { totals } = data;
  const maxDaily = Math.max(1, ...data.sentByDay.map((d) => d.count));

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-8 py-10">
      <h1 className="font-display text-2xl mb-1">Analytics</h1>
      <p className="text-ink-soft text-sm mb-8">Counted from your actual outreach records.</p>

      {totals.drafted === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-ink-soft text-sm">No outreach yet — analytics will show up once you start a campaign.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            <Stat label="Drafted" value={totals.drafted} />
            <Stat label="Sent" value={totals.sent} hint="Includes emails later replied to or bounced" />
            <Stat label="Bounce rate" value={pct(totals.bounced, totals.sent)} />
            {data.replyTrackingEnabled ? (
              <Stat label="Reply rate" value={pct(totals.replied, totals.sent)} />
            ) : (
              <Stat label="Avg. match score" value={data.averageMatchScore !== null ? data.averageMatchScore.toFixed(1) : "—"} />
            )}
          </div>
          {!data.replyTrackingEnabled && (
            <p className="text-xs text-ink-soft mb-8">Reply tracking is off for your Gmail connection, so reply metrics aren't shown. Enable it from Settings.</p>
          )}

          <div className="card p-6 mt-4">
            <h3 className="font-display text-base mb-4">Emails sent per day (last 30 days, UTC)</h3>
            {data.sentByDay.length === 0 ? (
              <p className="text-sm text-ink-soft">Nothing sent in this window yet.</p>
            ) : (
              <div className="flex items-end gap-1 h-32" role="img" aria-label="Bar chart of emails sent per day">
                {data.sentByDay.map((d) => (
                  <div key={d.date} className="flex-1 h-full flex items-end">
                    <div
                      className="w-full bg-verified rounded-t"
                      style={{ height: `${(d.count / maxDaily) * 100}%`, minHeight: "2px" }}
                      title={`${d.count} on ${new Date(d.date).toLocaleDateString()}`}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="card p-4" title={hint}>
      <p className="label mb-1">{label}</p>
      <p className="font-display text-2xl">{value}</p>
    </div>
  );
}
