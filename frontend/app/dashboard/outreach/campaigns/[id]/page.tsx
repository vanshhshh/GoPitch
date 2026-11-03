"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";
import { Mail, MailX, Play, Reply, Rocket } from "lucide-react";
import { ApiError, api, errorMessage } from "@/lib/api";
import { announceQuotaExhausted } from "@/lib/events";
import { ErrorState, LoadingSkeleton, MetricCard, Notice, Page, PageHeader, Section, StatusBadge } from "@/components/ui";
import { ConfirmationDialog } from "@/components/ui/overlays";
import { EmailCard, Quota, SendingConfig, SendRow } from "@/components/outreach/shared";

interface Detail {
  campaign: { id: string; name: string | null; companyName: string; status: "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELLED"; createdAt: string; launchedAt: string | null; tier: string };
  sends: SendRow[];
  timeline: { at: string; kind: string; label: string }[];
}

const GROUPS: { key: string; label: string; statuses: string[] }[] = [
  { key: "queued", label: "Queued", statuses: ["QUEUED"] },
  { key: "sent", label: "Sent", statuses: ["SENT"] },
  { key: "replied", label: "Replied", statuses: ["REPLIED"] },
  { key: "issues", label: "Failed & bounced", statuses: ["FAILED", "BOUNCED"] },
  { key: "cancelled", label: "Removed", statuses: ["CANCELLED"] },
];

export default function CampaignPage() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<Detail | null>(null);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"cancel" | "launch" | null>(null);
  const [group, setGroup] = useState("queued");

  const load = useCallback(() => {
    api.get<Detail>(`/api/campaigns/${id}`).then(setD).catch((err) => setError(errorMessage(err, "Couldn't load this campaign.")));
    api.get<Quota>("/api/sends/quota").then(setQuota).catch(() => {});
  }, [id]);
  useEffect(load, [load]);

  async function act(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      toast.error(errorMessage(err, "Something went wrong."));
      if (err instanceof ApiError && err.body?.upgradeRequired) announceQuotaExhausted({ tier: err.body.entitlementTier, limit: err.body.investorLimit });
    } finally {
      setBusy(null);
      setConfirm(null);
      load();
    }
  }

  const send = () =>
    act("send", async () => {
      const r = await api.post<{ dispatched: number; failed: number; stoppedReason?: string | null; message?: string; remainingQuota?: number }>(`/api/sends/campaigns/${id}/dispatch`);
      // Only what the backend confirms as sent is reported as sent.
      if (r.dispatched) toast.success(`${r.dispatched} email${r.dispatched === 1 ? "" : "s"} sent${r.failed ? `, ${r.failed} failed` : ""}.`);
      else if (r.failed) toast.error(`${r.failed} email${r.failed === 1 ? "" : "s"} failed.`);
      else toast(r.message ?? "Nothing to send right now.");
      if (r.stoppedReason) toast.error(r.stoppedReason, { duration: 8000 });
      if (r.remainingQuota === 0) announceQuotaExhausted({ tier: quota?.entitlementTier, limit: quota?.investorEmailsTotal });
    });

  if (error) return <Page><ErrorState message={error} onRetry={load} /></Page>;
  if (!d) return <Page><LoadingSkeleton rows={4} /></Page>;

  const { campaign, sends } = d;
  const count = (statuses: string[]) => sends.filter((s) => statuses.includes(s.status)).length;
  const queued = count(["QUEUED"]);
  const nextBatch = quota ? Math.min(queued, quota.remainingToday, quota.investorEmailsRemaining) : 0;
  const shown = sends.filter((s) => GROUPS.find((g) => g.key === group)!.statuses.includes(s.status));

  return (
    <Page>
      <PageHeader
        crumbs={[{ label: "Outreach", href: "/dashboard/outreach" }, { label: campaign.name ?? campaign.companyName }]}
        title={
          <span className="flex items-center gap-3">
            {campaign.name ?? campaign.companyName} <StatusBadge status={campaign.status} />
          </span>
        }
        description={`${campaign.companyName} · created ${new Date(campaign.createdAt).toLocaleDateString()}${campaign.launchedAt ? ` · launched ${new Date(campaign.launchedAt).toLocaleDateString()}` : ""}`}
        actions={
          <>
            {campaign.status === "DRAFT" && (
              <>
                <Link href="/dashboard/investors" className="btn-secondary">
                  Add investors
                </Link>
                <button className="btn-primary inline-flex items-center gap-1.5" onClick={() => setConfirm("launch")} disabled={!!busy || queued === 0}>
                  <Rocket size={14} aria-hidden /> Launch campaign
                </button>
              </>
            )}
            {campaign.status === "ACTIVE" && queued > 0 && (
              <button
                className="btn-primary inline-flex items-center gap-1.5"
                onClick={send}
                disabled={!!busy || nextBatch === 0 || !quota?.gmailConnected}
                title={!quota?.gmailConnected ? "Connect Gmail first" : quota?.quotaExhausted ? "Plan allowance used" : quota?.remainingToday === 0 ? "Daily limit reached" : undefined}
              >
                <Play size={14} aria-hidden /> {busy === "send" ? "Sending…" : `Send next ${nextBatch}`}
              </button>
            )}
            {campaign.status === "ACTIVE" && (
              <button className="btn-secondary" onClick={() => act("pause", async () => void (await api.post(`/api/campaigns/${id}/status`, { action: "pause" })))} disabled={!!busy}>
                Pause
              </button>
            )}
            {campaign.status === "PAUSED" && (
              <button className="btn-primary" onClick={() => act("resume", async () => void (await api.post(`/api/campaigns/${id}/status`, { action: "resume" })))} disabled={!!busy}>
                Resume
              </button>
            )}
          </>
        }
      />

      {campaign.status === "DRAFT" && (
        <div className="mb-6">
          <Notice tone="info">Review each email below — edit or remove anything — then launch. Nothing is sent until you launch and send a batch.</Notice>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <MetricCard label="Selected investors" value={sends.filter((s) => s.status !== "CANCELLED").length} />
        <MetricCard label="Sent" value={count(["SENT", "REPLIED", "BOUNCED"])} />
        <MetricCard label="Queued" value={queued} />
        <MetricCard label="Failed / bounced" value={count(["FAILED", "BOUNCED"])} tone={count(["FAILED", "BOUNCED"]) ? "danger" : undefined} />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex gap-1 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0" role="group" aria-label="Email status">
            {GROUPS.map((g) => (
              <button
                key={g.key}
                aria-pressed={group === g.key}
                onClick={() => setGroup(g.key)}
                className={`shrink-0 px-3 py-1.5 rounded text-xs ${group === g.key ? "bg-verified-soft text-verified" : "text-ink-soft hover:text-ink"}`}
              >
                {g.label} <span className="font-mono opacity-70">{count(g.statuses)}</span>
              </button>
            ))}
          </div>
          {group === "issues" && count(["FAILED"]) > 0 && campaign.status !== "CANCELLED" && (
            <button className="btn-secondary text-xs" disabled={!!busy} onClick={() => act("retry", async () => void toast.success(`${(await api.post<{ requeued: number }>(`/api/campaigns/${id}/retry-failed`)).requeued} queued again.`))}>
              Retry failed emails
            </button>
          )}
          {shown.length === 0 ? (
            <p className="text-sm text-ink-soft card p-6 text-center">No emails in this group.</p>
          ) : (
            shown.map((s) => <EmailCard key={s.id} send={s} campaignId={id} editable={campaign.status === "DRAFT" || campaign.status === "ACTIVE" || campaign.status === "PAUSED"} onChanged={load} />)
          )}
        </div>

        <div className="space-y-6">
          <Section title="Sending configuration">{quota ? <SendingConfig quota={quota} returnTo={`/dashboard/outreach/campaigns/${id}`} /> : <LoadingSkeleton rows={1} />}</Section>
          <Section title="Activity">
            {d.timeline.length === 0 ? (
              <p className="text-sm text-ink-soft">No activity yet.</p>
            ) : (
              <ol className="space-y-3">
                {d.timeline.slice(0, 20).map((t, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className="mt-0.5 text-ink-soft" aria-hidden>
                      {t.kind === "replied" ? <Reply size={14} className="text-teal" /> : t.kind === "bounced" ? <MailX size={14} className="text-danger" /> : <Mail size={14} />}
                    </span>
                    <span>
                      <span className="text-ink">{t.label}</span>
                      <span className="block text-[11px] text-ink-soft">{new Date(t.at).toLocaleString()}</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Section>
          {(campaign.status === "DRAFT" || campaign.status === "ACTIVE" || campaign.status === "PAUSED") && (
            <button className="btn-ghost text-danger text-sm w-full" onClick={() => setConfirm("cancel")}>
              {campaign.status === "DRAFT" ? "Discard draft campaign" : "Cancel campaign"}
            </button>
          )}
        </div>
      </div>

      <ConfirmationDialog
        open={confirm === "launch"}
        title="Launch this campaign?"
        message={`${queued} emails will be ready to send from your Gmail in daily batches. You can still edit queued emails, pause, or cancel later.`}
        confirmLabel="Launch"
        busy={busy === "launch"}
        onConfirm={() => act("launch", async () => {
          await api.post(`/api/campaigns/${id}/launch`);
          toast.success("Campaign launched.");
        })}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmationDialog
        open={confirm === "cancel"}
        title={campaign.status === "DRAFT" ? "Discard draft?" : "Cancel campaign?"}
        message={`${count(["QUEUED", "FAILED"])} unsent emails will be removed and released back to your plan allowance. Emails already sent are unaffected.`}
        confirmLabel={campaign.status === "DRAFT" ? "Discard" : "Cancel campaign"}
        destructive
        busy={busy === "cancel"}
        onConfirm={() => act("cancel", async () => void (await api.post(`/api/campaigns/${id}/status`, { action: "cancel" })))}
        onCancel={() => setConfirm(null)}
      />
    </Page>
  );
}
