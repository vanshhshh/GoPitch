"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";

interface Metrics {
  founderCount: number;
  companyCount: number;
  campaignCount: number;
  sendsByStatus: Record<string, number>;
  investorCount: number;
  unverifiedInvestorCount: number;
  flaggedUsers: { id: string; email: string; sendReputationScore: number; complaintReportedAt: string | null }[];
}

export default function AdminOverviewPage() {
  const router = useRouter();
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  useEffect(() => {
    api.get<Metrics>("/api/admin/metrics").then(setMetrics).catch((err) => {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) router.push("/login");
    });
  }, [router]);

  if (!metrics) {
    return (
      <div className="max-w-5xl mx-auto px-8 py-10">
        <p className="text-ink-soft text-sm">Loading…</p>
      </div>
    );
  }

  const stats = [
    { label: "Founders", value: metrics.founderCount },
    { label: "Companies", value: metrics.companyCount },
    { label: "Campaigns", value: metrics.campaignCount },
    { label: "Investors (total)", value: metrics.investorCount },
    { label: "Verified investors", value: Math.max(0, metrics.investorCount - metrics.unverifiedInvestorCount) },
    { label: "Pending verification", value: metrics.unverifiedInvestorCount },
  ];

  return (
    <div className="max-w-5xl mx-auto px-8 py-10">
      <h1 className="font-display text-2xl mb-1">Platform overview</h1>
      <p className="text-ink-soft text-sm mb-8">Real-time metrics across the whole platform.</p>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-8">
        {stats.map((s) => (
          <div key={s.label} className="card p-4">
            <p className="label mb-1">{s.label}</p>
            <p className="font-display text-2xl">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="card p-5 mb-8">
        <h3 className="font-display text-base mb-3">Sends by status</h3>
        <div className="flex gap-6 flex-wrap">
          {Object.entries(metrics.sendsByStatus).map(([status, count]) => (
            <div key={status}>
              <p className="font-mono text-xl">{count}</p>
              <p className="label">{status}</p>
            </div>
          ))}
          {Object.keys(metrics.sendsByStatus).length === 0 && <p className="text-sm text-ink-soft">No sends yet.</p>}
        </div>
      </div>

      {metrics.flaggedUsers.length > 0 && (
        <div className="card p-5 border-danger/20">
          <h3 className="font-display text-base mb-3 text-danger">Flagged accounts</h3>
          <div className="space-y-2">
            {metrics.flaggedUsers.map((u) => (
              <div key={u.id} className="flex items-center justify-between text-sm">
                <span>{u.email}</span>
                <span className="font-mono text-xs text-danger">
                  reputation {u.sendReputationScore.toFixed(2)}
                  {u.complaintReportedAt && " · spam complaint"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
