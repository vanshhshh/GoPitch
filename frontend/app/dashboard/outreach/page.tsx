"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Send } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";
import { EmptyState, ErrorState, LoadingSkeleton, Page, PageHeader, ProgressBar, ScorePill, StatusBadge, Tabs } from "@/components/ui";
import { DataTable } from "@/components/ui/overlays";
import { Pagination } from "@/components/Pagination";
import { Quota, SendingConfig } from "@/components/outreach/shared";

interface Campaign {
  id: string;
  companyId: string;
  companyName: string;
  name: string | null;
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELLED";
  createdAt: string;
  launchedAt: string | null;
  counts: { total: number; queued: number; sent: number; failed: number; bounced: number; replied: number };
}

const CAMPAIGN_TABS = [
  { key: "all", label: "All campaigns", match: () => true },
  { key: "draft", label: "Drafts", match: (c: Campaign) => c.status === "DRAFT" },
  { key: "active", label: "Active", match: (c: Campaign) => c.status === "ACTIVE" || c.status === "PAUSED" },
  { key: "completed", label: "Completed", match: (c: Campaign) => c.status === "COMPLETED" || c.status === "CANCELLED" },
];

export default function OutreachPage() {
  return (
    <Suspense fallback={<Page><LoadingSkeleton /></Page>}>
      <Outreach />
    </Suspense>
  );
}

function Outreach() {
  const params = useSearchParams();
  const tab = params.get("tab") ?? "all";
  const { companyId } = useWorkspace();
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api.get<Campaign[]>("/api/campaigns").then(setCampaigns).catch((err) => setError(errorMessage(err, "Couldn't load campaigns.")));
    api.get<Quota>("/api/sends/quota").then(setQuota).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const scoped = campaigns?.filter((c) => !companyId || c.companyId === companyId) ?? null;
  const tabs = [
    ...CAMPAIGN_TABS.map((t) => ({ key: t.key, label: t.label, href: `/dashboard/outreach?tab=${t.key}`, count: scoped?.filter(t.match).length })),
    { key: "activity", label: "Email activity", href: "/dashboard/outreach?tab=activity" },
    { key: "templates", label: "Templates", href: "/dashboard/outreach/templates" },
  ];

  return (
    <Page>
      <PageHeader
        title="Outreach"
        description="Select investors → review drafts → launch → send in safe daily batches from your own Gmail."
        actions={
          <Link href="/dashboard/outreach/new" className="btn-primary">
            New campaign
          </Link>
        }
      />
      <Tabs label="Outreach views" active={tab} tabs={tabs} />
      {tab === "activity" ? (
        <EmailActivity />
      ) : (
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            {error ? (
              <ErrorState message={error} onRetry={load} />
            ) : !scoped ? (
              <LoadingSkeleton rows={3} />
            ) : scoped.filter(CAMPAIGN_TABS.find((t) => t.key === tab)!.match).length === 0 ? (
              <EmptyState
                icon={<Send size={18} />}
                title={tab === "draft" ? "No draft campaigns" : tab === "completed" ? "No completed campaigns yet" : "No campaigns yet"}
                description="Pick investors in Investor Discovery, then create a campaign — you'll review every draft before anything sends."
                action={<Link href="/dashboard/investors" className="btn-primary">Find investors</Link>}
              />
            ) : (
              <DataTable
                caption="Campaigns"
                rows={scoped.filter(CAMPAIGN_TABS.find((t) => t.key === tab)!.match)}
                rowKey={(c) => c.id}
                columns={[
                  {
                    key: "name",
                    header: "Campaign",
                    render: (c) => (
                      <Link href={`/dashboard/outreach/campaigns/${c.id}`} className="text-navy font-medium hover:underline">
                        {c.name ?? c.companyName}
                      </Link>
                    ),
                  },
                  { key: "status", header: "Status", render: (c) => <StatusBadge status={c.status} /> },
                  {
                    key: "progress",
                    header: "Progress",
                    className: "w-48",
                    render: (c) => (
                      <div className="min-w-[8rem]">
                        <ProgressBar value={c.counts.total ? (c.counts.sent / c.counts.total) * 100 : 0} label={`${c.counts.sent} of ${c.counts.total} sent`} />
                        <p className="text-[11px] text-ink-soft mt-1 font-mono">
                          {c.counts.sent}/{c.counts.total} sent · {c.counts.queued} queued
                        </p>
                      </div>
                    ),
                  },
                  { key: "replies", header: "Replies", hideOnMobile: true, render: (c) => <span className="font-mono">{c.counts.replied}</span> },
                  { key: "issues", header: "Failed / bounced", hideOnMobile: true, render: (c) => <span className="font-mono">{c.counts.failed + c.counts.bounced}</span> },
                ]}
              />
            )}
          </div>
          <aside className="card p-5 h-fit">
            <h2 className="font-display text-lg mb-4">Sending capacity</h2>
            {quota ? <SendingConfig quota={quota} returnTo="/dashboard/outreach" /> : <LoadingSkeleton rows={1} />}
          </aside>
        </div>
      )}
    </Page>
  );
}

const STATUSES = ["ALL", "QUEUED", "SENT", "REPLIED", "BOUNCED", "FAILED", "CANCELLED"];

function EmailActivity() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const status = params.get("status") ?? "ALL";
  const campaignId = params.get("campaignId");
  const page = Number(params.get("page") ?? 1) || 1;
  const [data, setData] = useState<{ items: any[]; total: number; page: number; pageSize: number; counts: Record<string, number> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    router.replace(`${pathname}?${next}`, { scroll: false });
  };

  useEffect(() => {
    const qs = new URLSearchParams({ status, page: String(page), pageSize: "25" });
    if (campaignId) qs.set("campaignId", campaignId);
    api.get<typeof data>(`/api/sends?${qs}`).then(setData).catch((err) => setError(errorMessage(err, "Couldn't load email activity.")));
  }, [status, page, campaignId]);

  if (error) return <ErrorState message={error} />;
  const counts = data?.counts ?? {};
  return (
    <div>
      <div className="flex gap-1 overflow-x-auto mb-4 -mx-4 px-4 sm:mx-0 sm:px-0" role="group" aria-label="Filter by status">
        {STATUSES.map((s) => (
          <button
            key={s}
            aria-pressed={status === s}
            onClick={() => set({ status: s === "ALL" ? null : s, page: null })}
            className={`shrink-0 px-3 py-1.5 rounded text-xs transition-colors ${status === s ? "bg-verified-soft text-verified" : "text-ink-soft hover:text-ink"}`}
          >
            {s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()} <span className="font-mono opacity-70">{s === "ALL" ? Object.values(counts).reduce((a, b) => a + b, 0) : counts[s] ?? 0}</span>
          </button>
        ))}
      </div>
      {campaignId && (
        <p className="text-xs mb-3">
          One campaign ·{" "}
          <button className="text-verified hover:underline" onClick={() => set({ campaignId: null })}>
            show all
          </button>
        </p>
      )}
      {!data ? (
        <LoadingSkeleton rows={4} />
      ) : data.items.length === 0 ? (
        <EmptyState title="No emails here" description={status === "ALL" ? "Emails appear once you create a campaign." : "No emails with this status."} />
      ) : (
        <>
          <DataTable
            caption="Email activity"
            rows={data.items}
            rowKey={(r) => r.id}
            onRowClick={(r) => router.push(`/dashboard/outreach/campaigns/${r.campaignId}`)}
            columns={[
              { key: "score", header: "Fit", hideOnMobile: true, render: (r) => <ScorePill score={r.matchScore} /> },
              {
                key: "investor",
                header: "Investor",
                render: (r) => (
                  <span>
                    <span className="text-navy">{r.investorName}</span>
                    <span className="block text-xs text-ink-soft">{r.investorFirm.trim()}</span>
                  </span>
                ),
              },
              { key: "subject", header: "Subject", hideOnMobile: true, render: (r) => <span className="line-clamp-1">{r.subject}</span> },
              { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
              { key: "date", header: "Date", render: (r) => <span className="text-xs text-ink-soft">{r.repliedAt || r.sentAt ? new Date(r.repliedAt || r.sentAt).toLocaleDateString() : "—"}</span> },
            ]}
          />
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => set({ page: String(p) })} />
        </>
      )}
    </div>
  );
}
