"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { MatchStamp } from "@/components/MatchStamp";

interface Send {
  id: string;
  investorName: string;
  investorFirm: string;
  companyName: string;
  subject: string;
  matchScore: number;
  status: string;
  sentAt: string | null;
  bouncedAt: string | null;
}

const STATUS_STYLE: Record<string, string> = {
  QUEUED: "bg-line-soft text-ink-soft",
  SENT: "bg-verified-soft text-verified",
  BOUNCED: "bg-danger-soft text-danger",
  FAILED: "bg-danger-soft text-danger",
  SKIPPED_CAP_REACHED: "bg-signal-soft text-signal",
};

export default function OutreachPage() {
  const [sends, setSends] = useState<Send[] | null>(null);
  const [filter, setFilter] = useState<string>("ALL");

  useEffect(() => {
    api.get<Send[]>("/api/sends").then(setSends);
  }, []);

  const filtered = sends?.filter((s) => filter === "ALL" || s.status === filter) ?? [];

  return (
    <div className="max-w-4xl mx-auto px-8 py-10">
      <h1 className="font-display text-2xl mb-1">Outreach</h1>
      <p className="text-ink-soft text-sm mb-6">Every email drafted or sent, across all your campaigns.</p>

      <div className="flex gap-2 mb-6 text-xs">
        {["ALL", "QUEUED", "SENT", "BOUNCED", "FAILED"].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1 rounded transition-colors ${
              filter === s ? "bg-verified-soft text-verified" : "text-ink-soft hover:text-ink"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {sends === null ? (
        <p className="text-ink-soft text-sm">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-ink-soft text-sm">Nothing here yet.</p>
        </div>
      ) : (
        <div className="card divide-y divide-line-soft animate-fade-up">
          {filtered.map((s) => (
            <div key={s.id} className="p-4 flex items-center gap-4">
              <MatchStamp score={s.matchScore} size={32} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{s.subject}</p>
                <p className="text-xs text-ink-soft">
                  {s.investorName} · {s.investorFirm} — for {s.companyName}
                </p>
              </div>
              <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded shrink-0 ${STATUS_STYLE[s.status] || ""}`}>
                {s.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
