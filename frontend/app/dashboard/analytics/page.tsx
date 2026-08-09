"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { api } from "@/lib/api";

interface Analytics {
  sendsByStatus: Record<string, number>;
  averageMatchScore: number | null;
  sentByDay: { date: string; count: number }[];
}

export default function AnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);

  useEffect(() => {
    api.get<Analytics>("/api/sends/analytics").then(setData).catch(() => toast.error("Couldn't load analytics."));
  }, []);

  if (!data) {
    return (
      <div className="max-w-4xl mx-auto px-8 py-10">
        <p className="text-ink-soft text-sm">Loading…</p>
      </div>
    );
  }

  const totalSends = Object.values(data.sendsByStatus).reduce((a, b) => a + b, 0);
  const sent = data.sendsByStatus.SENT ?? 0;
  const bounced = data.sendsByStatus.BOUNCED ?? 0;
  const bounceRate = sent + bounced > 0 ? Math.round((bounced / (sent + bounced)) * 1000) / 10 : null;
  const maxDaily = Math.max(1, ...data.sentByDay.map((d) => d.count));

  return (
    <div className="max-w-4xl mx-auto px-8 py-10">
      <h1 className="font-display text-2xl mb-1">Analytics</h1>
      <p className="text-ink-soft text-sm mb-8">Real numbers from your outreach — no vanity metrics.</p>

      {totalSends === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-ink-soft text-sm">No outreach yet — analytics will show up once you send.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
            <Stat label="Total drafted" value={totalSends} />
            <Stat label="Sent" value={sent} />
            <Stat label="Bounce rate" value={bounceRate !== null ? `${bounceRate}%` : "—"} />
            <Stat label="Avg. match score" value={data.averageMatchScore !== null ? data.averageMatchScore.toFixed(1) : "—"} />
          </div>

          <div className="card p-6">
            <h3 className="font-display text-base mb-4">Sends over the last 30 days</h3>
            {data.sentByDay.length === 0 ? (
              <p className="text-sm text-ink-soft">No sends dispatched in this window yet.</p>
            ) : (
              <div className="flex items-end gap-1 h-32">
                {data.sentByDay.map((d) => (
                  <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group relative">
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

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card p-4">
      <p className="label mb-1">{label}</p>
      <p className="font-display text-2xl">{value}</p>
    </div>
  );
}
