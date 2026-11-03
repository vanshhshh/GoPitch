"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, errorMessage } from "@/lib/api";
import { MatchStamp } from "@/components/MatchStamp";
import { Pagination } from "@/components/Pagination";

interface Send {
  id: string;
  investorName: string;
  investorFirm: string;
  companyName: string;
  subject: string;
  matchScore: number;
  status: string;
  failureReason: string | null;
  sentAt: string | null;
  bouncedAt: string | null;
  repliedAt: string | null;
}

interface SendPage {
  items: Send[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<string, number>;
}

const STATUS_STYLE: Record<string, string> = {
  QUEUED: "bg-line-soft text-ink-soft",
  SENT: "bg-verified-soft text-verified",
  REPLIED: "bg-signal-soft text-signal",
  BOUNCED: "bg-danger-soft text-danger",
  FAILED: "bg-danger-soft text-danger",
  CANCELLED: "bg-line-soft text-ink-soft",
  SKIPPED_CAP_REACHED: "bg-line-soft text-ink-soft",
};

const FILTERS = ["ALL", "QUEUED", "SENT", "REPLIED", "BOUNCED", "FAILED", "CANCELLED"] as const;
const LABELS: Record<string, string> = { ALL: "All", QUEUED: "Queued", SENT: "Sent", REPLIED: "Replied", BOUNCED: "Bounced", FAILED: "Failed", CANCELLED: "Cancelled" };

export default function OutreachPage() {
  return (
    <Suspense fallback={<div className="max-w-4xl mx-auto px-4 sm:px-8 py-10 text-ink-soft text-sm">Loading…</div>}>
      <Outreach />
    </Suspense>
  );
}

function Outreach() {
  const campaignId = useSearchParams().get("campaignId");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<SendPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ status: filter, page: String(page), pageSize: "25" });
    if (campaignId) params.set("campaignId", campaignId);
    api
      .get<SendPage>(`/api/sends?${params}`)
      .then((d) => !cancelled && (setData(d), setError(null)))
      .catch((err) => !cancelled && setError(errorMessage(err, "Couldn't load outreach.")))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [filter, page, campaignId]);

  const counts = data?.counts ?? {};
  // "Sent" = every email that left your outbox, including those later replied to or bounced.
  const everSent = (counts.SENT ?? 0) + (counts.REPLIED ?? 0) + (counts.BOUNCED ?? 0);
  const all = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-8 py-10">
      <h1 className="font-display text-2xl mb-1">Outreach</h1>
      <p className="text-ink-soft text-sm mb-2">
        Every email drafted for your campaigns. A campaign drafts emails only for the investors selected for it (your best matches, up to your plan
        allowance) — so this is usually fewer than your total matches.
      </p>
      {data && (
        <p className="text-xs text-ink-soft mb-6 font-mono">
          {all} drafted · {everSent} sent · {counts.QUEUED ?? 0} queued · {counts.FAILED ?? 0} failed
        </p>
      )}
      {campaignId && (
        <p className="text-xs mb-4">
          Showing one campaign ·{" "}
          <Link href="/dashboard/outreach" className="text-verified hover:underline">
            show all campaigns
          </Link>
        </p>
      )}

      <div className="flex gap-1 mb-6 text-xs overflow-x-auto pb-1" role="tablist">
        {FILTERS.map((s) => {
          const count = s === "ALL" ? all : counts[s] ?? 0;
          return (
            <button
              key={s}
              role="tab"
              aria-selected={filter === s}
              onClick={() => (setFilter(s), setPage(1))}
              className={`px-3 py-1 rounded transition-colors flex items-center gap-1.5 shrink-0 ${filter === s ? "bg-verified-soft text-verified" : "text-ink-soft hover:text-ink"}`}
            >
              <span>{LABELS[s]}</span>
              <span className="font-mono opacity-70">{count}</span>
            </button>
          );
        })}
      </div>
      {campaignId && <p className="text-[11px] text-ink-soft -mt-4 mb-4">Counts above are across all campaigns.</p>}

      {error ? (
        <div className="card p-6 text-sm text-danger">{error}</div>
      ) : !data ? (
        <p className="text-ink-soft text-sm">Loading…</p>
      ) : data.items.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-ink-soft text-sm mb-4">{all === 0 ? "No outreach yet. Start a campaign from one of your raises." : "No emails in this view."}</p>
          {all === 0 && (
            <Link href="/dashboard" className="btn-primary inline-block">
              Go to your raises
            </Link>
          )}
        </div>
      ) : (
        <>
          <div className={`card divide-y divide-line-soft animate-fade-up ${loading ? "opacity-60" : ""}`}>
            {data.items.map((s) => (
              <div key={s.id} className="p-4 flex items-center gap-4">
                <MatchStamp score={s.matchScore} size={32} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{s.subject}</p>
                  <p className="text-xs text-ink-soft truncate">
                    {s.investorName} · {s.investorFirm} — for {s.companyName}
                  </p>
                  {s.status === "FAILED" && s.failureReason && <p className="text-xs text-danger truncate">{s.failureReason}</p>}
                </div>
                <div className="text-right shrink-0">
                  <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded ${STATUS_STYLE[s.status] || ""}`}>{LABELS[s.status] ?? s.status}</span>
                  {(s.repliedAt || s.sentAt) && (
                    <p className="text-[10px] text-ink-soft mt-1">{new Date(s.repliedAt || s.sentAt!).toLocaleDateString()}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      )}
    </div>
  );
}
