"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface AdminCampaign {
  id: string;
  founderEmail: string;
  companyName: string;
  tier: string;
  matchedInvestorCount: number;
  status: string;
  createdAt: string;
}

export default function AdminCampaignsPage() {
  const [campaigns, setCampaigns] = useState<AdminCampaign[] | null>(null);

  useEffect(() => {
    api.get<AdminCampaign[]>("/api/admin/campaigns").then(setCampaigns);
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-8 py-10">
      <h1 className="font-display text-2xl mb-1">Campaigns</h1>
      <p className="text-ink-soft text-sm mb-8">Every outreach campaign across every founder.</p>

      {campaigns === null ? (
        <p className="text-ink-soft text-sm">Loading…</p>
      ) : (
        <div className="card divide-y divide-line-soft">
          {campaigns.map((c) => (
            <div key={c.id} className="p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{c.companyName}</p>
                <p className="text-xs text-ink-soft">{c.founderEmail}</p>
              </div>
              <div className="text-right text-xs text-ink-soft">
                <p>
                  {c.tier} · {c.matchedInvestorCount} matched
                </p>
                <p className="font-mono">{c.status}</p>
              </div>
            </div>
          ))}
          {campaigns.length === 0 && <p className="p-4 text-sm text-ink-soft">No campaigns yet.</p>}
        </div>
      )}
    </div>
  );
}
