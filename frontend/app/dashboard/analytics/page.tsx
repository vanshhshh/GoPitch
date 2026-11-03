"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useWorkspace, withCompany } from "@/lib/workspace";
import { EmptyState, ErrorState, LoadingSkeleton, MetricCard, Page, PageHeader, Section, StatusBadge } from "@/components/ui";
import { DataTable } from "@/components/ui/overlays";

interface Analytics {
  sendsByStatus: Record<string, number>;
  totals: { drafted: number; sent: number; replied: number; bounced: number };
  replyTrackingEnabled: boolean;
  averageMatchScore: number | null;
  sentByDay: { date: string; count: number }[];
  byCampaign: { id: string; name: string | null; status: string; companyName: string; drafted: number; sent: number; replied: number; bounced: number }[];
}

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 1000) / 10}%` : "—");

export default function AnalyticsPage() {
  const { companyId } = useWorkspace();
  const [data, setData] = useState<Analytics | null>(null);
  const [matches, setMatches] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api.get<Analytics>("/api/sends/analytics").then(setData).catch((err) => setError(errorMessage(err, "Couldn't load analytics.")));
    api.get<{ matches?: { total: number } }>(withCompany("/api/overview", companyId)).then((o) => setMatches(o.matches?.total ?? null)).catch(() => {});
  }, [companyId]);
  useEffect(load, [load]);

  if (error) return <Page><ErrorState message={error} onRetry={load} /></Page>;
  if (!data) return <Page><LoadingSkeleton rows={4} /></Page>;
  const { totals } = data;
  const maxDaily = Math.max(1, ...data.sentByDay.map((d) => d.count));
  const funnel = [
    { label: "Matched investors", value: matches, href: "/dashboard/investors" },
    { label: "Drafted", value: totals.drafted, href: "/dashboard/outreach?tab=activity" },
    { label: "Sent", value: totals.sent, href: "/dashboard/outreach?tab=activity&status=SENT" },
    ...(data.replyTrackingEnabled ? [{ label: "Replied", value: totals.replied, href: "/dashboard/outreach?tab=activity&status=REPLIED" }] : []),
  ];
  const funnelMax = Math.max(1, ...funnel.map((f) => f.value ?? 0));

  return (
    <Page>
      <PageHeader title="Analytics" description="Counted from your actual outreach records. Click any number to see the emails behind it." />
      {totals.drafted === 0 ? (
        <EmptyState icon={<BarChart3 size={18} />} title="No outreach yet" description="Analytics appear once you create and send a campaign." action={<Link href="/dashboard/investors" className="btn-primary">Find investors</Link>} />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricCard label="Emails sent" value={totals.sent} hint="Includes ones later replied to or bounced" href="/dashboard/outreach?tab=activity&status=SENT" />
            <MetricCard label="Bounce rate" value={pct(totals.bounced, totals.sent)} href="/dashboard/outreach?tab=activity&status=BOUNCED" tone={totals.sent && totals.bounced / totals.sent > 0.05 ? "danger" : undefined} />
            {data.replyTrackingEnabled ? (
              <MetricCard label="Reply rate" value={pct(totals.replied, totals.sent)} href="/dashboard/outreach?tab=activity&status=REPLIED" />
            ) : (
              <MetricCard label="Reply rate" value="—" hint="Reply tracking is off" href="/dashboard/settings?tab=gmail" />
            )}
            <MetricCard label="Avg. match score" value={data.averageMatchScore != null ? data.averageMatchScore.toFixed(1) : "—"} href="/dashboard/investors" />
          </div>

          <Section title="Outreach funnel" description={data.replyTrackingEnabled ? undefined : "Replies aren't shown because reply tracking is off for your Gmail connection."}>
            <ol className="space-y-3">
              {funnel.map((f) => (
                <li key={f.label}>
                  <Link href={f.href} className="block group">
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-navy group-hover:underline">{f.label}</span>
                      <span className="font-mono">{f.value == null ? "—" : f.value.toLocaleString()}</span>
                    </div>
                    <div className="h-2 bg-line-soft rounded-full overflow-hidden" aria-hidden>
                      <div className="h-full bg-verified" style={{ width: `${((f.value ?? 0) / funnelMax) * 100}%` }} />
                    </div>
                  </Link>
                </li>
              ))}
            </ol>
          </Section>

          <Section title="Campaign performance">
            <DataTable
              caption="Campaign performance"
              rows={data.byCampaign}
              rowKey={(c) => c.id}
              columns={[
                {
                  key: "name",
                  header: "Campaign",
                  render: (c) => (
                    <Link href={`/dashboard/outreach/campaigns/${c.id}`} className="text-navy hover:underline">
                      {c.name ?? c.companyName}
                    </Link>
                  ),
                },
                { key: "status", header: "Status", render: (c) => <StatusBadge status={c.status} /> },
                { key: "sent", header: "Sent", render: (c) => <span className="font-mono">{c.sent}/{c.drafted}</span> },
                { key: "replied", header: "Replies", render: (c) => <span className="font-mono">{data.replyTrackingEnabled ? `${c.replied} (${pct(c.replied, c.sent)})` : "—"}</span> },
                { key: "bounced", header: "Bounced", render: (c) => <span className="font-mono">{c.bounced}</span> },
              ]}
            />
          </Section>

          <Section title="Emails sent per day" description="Last 30 days, UTC.">
            {data.sentByDay.length === 0 ? (
              <p className="text-sm text-ink-soft">Nothing sent in this window.</p>
            ) : (
              <div className="flex items-end gap-1 h-32" role="img" aria-label={`Bar chart of emails sent per day; peak ${maxDaily}`}>
                {data.sentByDay.map((d) => (
                  <div key={d.date} className="flex-1 h-full flex items-end">
                    <div className="w-full bg-verified rounded-t" style={{ height: `${(d.count / maxDaily) * 100}%`, minHeight: "2px" }} title={`${d.count} on ${new Date(d.date).toLocaleDateString()}`} />
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      )}
    </Page>
  );
}
