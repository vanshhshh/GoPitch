"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface AdminCompany {
  id: string;
  name: string;
  oneLiner: string;
  founderEmail: string;
  stage: string;
  askAmountUsd: number;
  deckCount: number;
  campaignCount: number;
  createdAt: string;
}

export default function AdminCompaniesPage() {
  const [companies, setCompanies] = useState<AdminCompany[] | null>(null);

  useEffect(() => {
    api.get<AdminCompany[]>("/api/admin/companies").then(setCompanies);
  }, []);

  return (
    <div className="max-w-5xl mx-auto px-8 py-10">
      <h1 className="font-display text-2xl mb-1">Companies</h1>
      <p className="text-ink-soft text-sm mb-8">Every company profile created on the platform.</p>

      {companies === null ? (
        <p className="text-ink-soft text-sm">Loading…</p>
      ) : companies.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-ink-soft text-sm">No companies yet.</p>
        </div>
      ) : (
        <div className="card divide-y divide-line-soft">
          {companies.map((c) => (
            <div key={c.id} className="p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{c.name}</p>
                <p className="text-xs text-ink-soft">{c.oneLiner}</p>
                <p className="text-xs text-ink-soft font-mono mt-0.5">{c.founderEmail}</p>
              </div>
              <div className="text-right text-xs text-ink-soft">
                <p>
                  {c.stage.replace("_", " ")} · ${c.askAmountUsd.toLocaleString()}
                </p>
                <p>
                  {c.deckCount} deck{c.deckCount === 1 ? "" : "s"} · {c.campaignCount} campaign
                  {c.campaignCount === 1 ? "" : "s"}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
