"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, Circle, MailCheck, MailX, Reply, Send } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useWorkspace, withCompany } from "@/lib/workspace";
import { EmptyState, ErrorState, LoadingSkeleton, MetricCard, Page, ProgressBar } from "@/components/ui";

interface Overview {
  user: { name: string | null };
  company: { id: string; name: string; oneLiner: string | null } | null;
  profile?: { percent: number; onboardingComplete: boolean; intelligenceStatus: string | null; suggestions: { label: string; required: boolean; href: string }[] };
  matches?: { total: number; funds: number; notYetContacted: number; nextCampaignSize: number; saved: number; incomplete: boolean };
  plan?: { tier: string; limit: number; sent: number; remainingToSend: number; remainingToAllocate: number };
  outreach?: { campaigns: { draft: number; active: number; completed: number }; sent: number; queued: number; replied: number; bounced: number; failed: number };
  gmail?: { connected: boolean; replyTracking: boolean };
  activity?: { kind: "sent" | "replied" | "bounced"; at: string; investorId: string; investorName: string; firm: string; campaignId: string }[];
  alerts?: { tone: "danger" | "signal"; text: string; href: string }[];
  nextAction: { key: string; title: string; description: string; href: string; cta: string };
  journey: { key: string; label: string; state: "done" | "current" | "upcoming"; href: string }[];
}

function greeting(name: string | null) {
  const h = new Date().getHours();
  const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return name ? `${part}, ${name.split(" ")[0]}` : part;
}

export default function OverviewPage() {
  const { companyId } = useWorkspace();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api
      .get<Overview>(withCompany("/api/overview", companyId))
      .then(setData)
      .catch((err) => setError(errorMessage(err, "Couldn't load your overview.")));
  }, [companyId]);
  useEffect(load, [load]);

  if (error) return <Page><ErrorState message={error} onRetry={load} /></Page>;
  if (!data) return <Page><LoadingSkeleton rows={4} label="Loading overview" /></Page>;

  const { nextAction } = data;
  return (
    <Page>
      <header className="mb-8">
        <p className="text-sm text-ink-soft">{greeting(data.user.name)}</p>
        <h1 className="font-display text-3xl mt-1">{data.company ? data.company.name : "Your fundraising workspace"}</h1>
        {data.company?.oneLiner && <p className="text-ink-soft text-sm mt-1">{data.company.oneLiner}</p>}
      </header>

      {/* Fundraising journey */}
      <section aria-label="Fundraising journey" className="card p-4 sm:p-5 mb-6">
        <ol className="grid grid-cols-1 sm:grid-cols-5 gap-3">
          {data.journey.map((s) => (
            <li key={s.key}>
              <Link href={s.href} className="flex sm:flex-col items-center sm:items-start gap-2 group">
                {s.state === "done" ? (
                  <CheckCircle2 size={18} className="text-verified shrink-0" aria-hidden />
                ) : (
                  <Circle size={18} className={s.state === "current" ? "text-navy shrink-0" : "text-line shrink-0"} aria-hidden />
                )}
                <span className={`text-sm ${s.state === "current" ? "text-navy font-medium" : s.state === "done" ? "text-ink" : "text-ink-soft"} group-hover:underline`}>
                  {s.label}
                  <span className="sr-only"> — {s.state}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      {/* Next action */}
      <section aria-label="Recommended next step" className="rounded-lg bg-navy text-white p-5 sm:p-6 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-white/60 mb-1">Next step</p>
          <p className="font-display text-xl text-white">{nextAction.title}</p>
          <p className="text-sm text-white/75 mt-1 max-w-xl">{nextAction.description}</p>
        </div>
        <Link href={nextAction.href} className="shrink-0 inline-flex items-center justify-center gap-2 bg-white text-navy font-medium text-sm px-4 py-2.5 rounded hover:bg-paper">
          {nextAction.cta} <ArrowRight size={14} aria-hidden />
        </Link>
      </section>

      {data.alerts && data.alerts.length > 0 && (
        <ul className="space-y-2 mb-6" aria-label="Alerts">
          {data.alerts.map((a) => (
            <li key={a.text}>
              <Link href={a.href} className={`flex items-center gap-2 text-sm rounded border px-3 py-2 hover:underline ${a.tone === "danger" ? "text-danger bg-danger-soft border-danger/20" : "text-signal bg-signal-soft border-signal/20"}`}>
                <AlertTriangle size={14} aria-hidden /> {a.text}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {!data.company ? (
        <EmptyState title="Start with your company profile" description="Everything in GoPitch — matching, drafts, outreach — builds on it." action={<Link href="/onboarding" className="btn-primary">Build profile</Link>} />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <MetricCard label="Investor matches" value={data.matches!.total.toLocaleString()} hint={data.matches!.incomplete ? "Complete your profile to match" : "Eligible people across all funds"} href="/dashboard/investors" />
            <MetricCard label="Unique funds" value={data.matches!.funds.toLocaleString()} href="/dashboard/investors?view=funds" />
            <MetricCard
              label="Next campaign"
              value={data.matches!.nextCampaignSize.toLocaleString()}
              hint={`Not yet contacted, within your ${data.plan!.tier === "FREE" ? "Free" : data.plan!.tier.toLowerCase()} plan allowance`}
              href="/dashboard/investors"
            />
            <MetricCard label="Emails left in plan" value={`${data.plan!.remainingToSend} / ${data.plan!.limit}`} tone={data.plan!.remainingToSend === 0 ? "danger" : undefined} href="/dashboard/billing" />
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            <section className="card p-5 lg:col-span-2" aria-labelledby="outreach-h">
              <div className="flex items-center justify-between mb-4">
                <h2 id="outreach-h" className="font-display text-lg">Outreach</h2>
                <Link href="/dashboard/outreach" className="text-xs text-verified hover:underline">
                  All campaigns
                </Link>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                <Mini label="Sent" value={data.outreach!.sent} href="/dashboard/outreach?tab=activity&status=SENT" />
                <Mini label="Queued" value={data.outreach!.queued} href="/dashboard/outreach?tab=activity&status=QUEUED" />
                <Mini label={data.gmail!.replyTracking ? "Replies" : "Replies (tracking off)"} value={data.gmail!.replyTracking ? data.outreach!.replied : "—"} href="/dashboard/outreach?tab=activity&status=REPLIED" />
                <Mini label="Bounced / failed" value={data.outreach!.bounced + data.outreach!.failed} href="/dashboard/outreach?tab=activity&status=BOUNCED" />
              </div>
              <p className="label mb-2">Recent activity</p>
              {data.activity!.length === 0 ? (
                <p className="text-sm text-ink-soft">No emails sent yet. Activity from your campaigns will appear here.</p>
              ) : (
                <ul className="divide-y divide-line-soft">
                  {data.activity!.map((a, i) => (
                    <li key={i} className="py-2.5 flex items-center gap-3 text-sm">
                      {a.kind === "replied" ? <Reply size={14} className="text-teal" aria-hidden /> : a.kind === "bounced" ? <MailX size={14} className="text-danger" aria-hidden /> : <MailCheck size={14} className="text-verified" aria-hidden />}
                      <span className="flex-1 min-w-0 truncate">
                        <Link href={`/dashboard/investors/people/${a.investorId}`} className="text-navy hover:underline">
                          {a.investorName}
                        </Link>{" "}
                        <span className="text-ink-soft">({a.firm.trim()})</span> {a.kind === "replied" ? "replied" : a.kind === "bounced" ? "— email bounced" : "— email sent"}
                      </span>
                      <Link href={`/dashboard/outreach/campaigns/${a.campaignId}`} className="text-xs text-ink-soft hover:text-ink shrink-0">
                        {new Date(a.at).toLocaleDateString()}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card p-5" aria-labelledby="profile-h">
              <h2 id="profile-h" className="font-display text-lg mb-3">Company profile</h2>
              <ProgressBar value={data.profile!.percent} label="Profile completeness" />
              <p className="text-xs text-ink-soft mt-2 mb-4">
                {data.profile!.percent}% complete{data.profile!.intelligenceStatus === "CONFIRMED" ? " · summary confirmed" : ""}
              </p>
              {data.profile!.suggestions.length === 0 ? (
                <p className="text-sm text-ink-soft">Your profile is complete.</p>
              ) : (
                <>
                  <p className="label mb-2">Improve your matches</p>
                  <ul className="space-y-1.5">
                    {data.profile!.suggestions.map((s) => (
                      <li key={s.label}>
                        <Link href={data.profile!.onboardingComplete ? s.href : "/onboarding"} className="text-sm text-ink hover:text-verified flex items-center justify-between gap-2">
                          <span>
                            Add {s.label.toLowerCase()}
                            {s.required && <span className="text-danger"> *</span>}
                          </span>
                          <ArrowRight size={12} aria-hidden />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {!data.gmail!.connected && (
                <Link href="/dashboard/settings?tab=gmail" className="mt-5 flex items-center gap-2 text-sm text-verified hover:underline">
                  <Send size={14} aria-hidden /> Connect Gmail to send
                </Link>
              )}
            </section>
          </div>
        </>
      )}
    </Page>
  );
}

function Mini({ label, value, href }: { label: string; value: number | string; href: string }) {
  return (
    <Link href={href} className="rounded border border-line-soft p-3 hover:border-ink-soft">
      <p className="font-display text-xl text-navy">{typeof value === "number" ? value.toLocaleString() : value}</p>
      <p className="text-[11px] text-ink-soft">{label}</p>
    </Link>
  );
}
