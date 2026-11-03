"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";
import { Sparkles, FileText } from "lucide-react";
import { ApiError, api, errorMessage } from "@/lib/api";
import { announceQuotaExhausted } from "@/lib/events";
import { useWorkspace, withCompany } from "@/lib/workspace";
import { FormField, LoadingSkeleton, Notice, Page, PageHeader, ProgressIndicator, ScorePill } from "@/components/ui";
import { useSelection } from "@/components/investors/shared";

interface Pick {
  id: string;
  name: string;
  firm: string;
  score: number;
  alreadyContacted: boolean;
}

/** Guided campaign creation: recipients → how to draft → name → create a DRAFT for review. */
export default function NewCampaignPage() {
  const router = useRouter();
  const { companyId, company } = useWorkspace();
  const sel = useSelection();
  const [step, setStep] = useState(0);
  const [allowance, setAllowance] = useState<{ tier: string; remainingToAllocate: number } | null>(null);
  const [top, setTop] = useState<Pick[] | null>(null);
  const [selectedInfo, setSelectedInfo] = useState<Pick[] | null>(null);
  // "auto" until the founder chooses: picks "selected" when there's an eligible selection,
  // decided only after the selection has actually loaded (avoids a first-render race).
  const [modeChoice, setMode] = useState<"auto" | "selected" | "top">("auto");
  const [templates, setTemplates] = useState<{ id: string; name: string; subject: string }[]>([]);
  const [templateId, setTemplateId] = useState<string>("");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api.get<{ tier: string; remainingToAllocate: number }>("/api/discovery/allowance").then(setAllowance).catch(() => {});
    api.get<{ id: string; name: string; subject: string }[]>("/api/email-templates").then(setTemplates).catch(() => {});
  }, []);

  useEffect(() => {
    if (!companyId) return;
    api
      .get<{ items: Pick[] }>(withCompany("/api/discovery/matches?pageSize=100&hideContacted=true", companyId))
      .then((r) => setTop(r.items))
      .catch(() => setTop([]));
  }, [companyId]);

  useEffect(() => {
    if (!sel.ids.length) {
      setSelectedInfo([]);
      return;
    }
    // Resolve selected ids against current eligible matches (anything no longer eligible is shown as such).
    Promise.all(
      sel.ids.slice(0, 200).map((id) =>
        api
          .get<{ id: string; name: string; firm: string; match: { score: number } | null; alreadyContacted: boolean }>(withCompany(`/api/discovery/people/${id}`, companyId))
          .then((p) => ({ id: p.id, name: p.name, firm: p.firm, score: p.match?.score ?? -1, alreadyContacted: p.alreadyContacted }))
          .catch(() => null)
      )
    ).then((rows) => setSelectedInfo(rows.filter((r): r is Pick => !!r)));
  }, [sel.ids, companyId]);

  const limit = allowance?.remainingToAllocate ?? 0;
  const eligibleSelected = (selectedInfo ?? []).filter((p) => p.score >= 0 && !p.alreadyContacted);
  const mode = modeChoice === "auto" ? (eligibleSelected.length ? "selected" : "top") : modeChoice;
  const recipients = mode === "selected" ? eligibleSelected.slice(0, limit) : (top ?? []).slice(0, limit);

  async function create() {
    setCreating(true);
    try {
      const r = await api.post<{ campaign: { id: string }; selectedCount: number }>("/api/campaigns", {
        companyId,
        investorIds: mode === "selected" ? recipients.map((p) => p.id) : undefined,
        templateId: templateId || undefined,
        name: name.trim() || undefined,
      });
      if (mode === "selected") sel.clear();
      toast.success(`${r.selectedCount} drafts ready for review.`);
      router.push(`/dashboard/outreach/campaigns/${r.campaign.id}`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't create the campaign."));
      if (err instanceof ApiError && err.body?.upgradeRequired) announceQuotaExhausted({ tier: err.body.entitlementTier });
      setCreating(false);
    }
  }

  return (
    <Page width="form">
      <PageHeader crumbs={[{ label: "Outreach", href: "/dashboard/outreach" }, { label: "New campaign" }]} title="New campaign" description={company ? `For ${company.name}` : undefined} />
      <div className="mb-6">
        <ProgressIndicator steps={["Recipients", "Drafting", "Review & create"]} current={step} onSelect={(i) => i < step && setStep(i)} />
      </div>

      {allowance && limit === 0 && (
        <div className="mb-6">
          <Notice tone="danger" action={<Link href="/dashboard/billing" className="btn-secondary text-xs">See plans</Link>}>
            Your plan's email allowance is fully used or already drafted.
          </Notice>
        </div>
      )}

      <div className="card p-5 sm:p-6">
        {step === 0 && (
          <div className="space-y-4">
            <h2 className="font-display text-lg">Who should receive this campaign?</h2>
            {selectedInfo === null || top === null ? (
              <LoadingSkeleton rows={2} />
            ) : (
              <>
                <div className="space-y-2" role="radiogroup" aria-label="Recipients">
                  <label className={`flex items-start gap-3 card p-4 cursor-pointer ${mode === "selected" ? "border-verified" : ""} ${eligibleSelected.length ? "" : "opacity-60"}`}>
                    <input type="radio" name="mode" checked={mode === "selected"} disabled={!eligibleSelected.length} onChange={() => setMode("selected")} className="mt-1" />
                    <span>
                      <span className="block text-sm font-medium text-navy">Investors I selected ({eligibleSelected.length})</span>
                      <span className="block text-xs text-ink-soft">
                        {eligibleSelected.length ? "Hand-picked from Investor Discovery." : "You haven't selected anyone yet — "}
                        {!eligibleSelected.length && (
                          <Link href="/dashboard/investors" className="text-verified hover:underline">
                            browse matches
                          </Link>
                        )}
                      </span>
                    </span>
                  </label>
                  <label className={`flex items-start gap-3 card p-4 cursor-pointer ${mode === "top" ? "border-verified" : ""}`}>
                    <input type="radio" name="mode" checked={mode === "top"} onChange={() => setMode("top")} className="mt-1" />
                    <span>
                      <span className="block text-sm font-medium text-navy">My best {Math.min(limit, top.length)} matches</span>
                      <span className="block text-xs text-ink-soft">Highest-scoring investors you haven't contacted yet.</span>
                    </span>
                  </label>
                </div>
                {(selectedInfo ?? []).length > eligibleSelected.length && mode === "selected" && (
                  <p className="text-xs text-signal">{selectedInfo!.length - eligibleSelected.length} selected investors are no longer eligible (already contacted or excluded) and will be skipped.</p>
                )}
                {mode === "selected" && eligibleSelected.length > limit && (
                  <p className="text-xs text-signal">Your plan allows {limit} more — only your top {limit} selections will be drafted.</p>
                )}
                <ul className="divide-y divide-line-soft max-h-72 overflow-y-auto border border-line-soft rounded">
                  {recipients.map((p) => (
                    <li key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <ScorePill score={p.score} />
                      <span className="min-w-0">
                        <span className="text-navy">{p.name}</span> <span className="text-ink-soft">· {p.firm.trim()}</span>
                      </span>
                    </li>
                  ))}
                  {recipients.length === 0 && <li className="px-3 py-4 text-sm text-ink-soft">No eligible recipients.</li>}
                </ul>
                <div className="flex justify-end">
                  <button className="btn-primary" disabled={recipients.length === 0} onClick={() => setStep(1)}>
                    Continue with {recipients.length}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <h2 className="font-display text-lg">How should we draft the emails?</h2>
            <label className={`flex items-start gap-3 card p-4 cursor-pointer ${!templateId ? "border-verified" : ""}`}>
              <input type="radio" name="draft" checked={!templateId} onChange={() => setTemplateId("")} className="mt-1" />
              <span>
                <span className="flex items-center gap-1.5 text-sm font-medium text-navy">
                  <Sparkles size={14} aria-hidden /> Personalized with AI
                </span>
                <span className="block text-xs text-ink-soft">One email per investor, grounded in the actual match reasons. You'll review every draft.</span>
              </span>
            </label>
            {templates.map((t) => (
              <label key={t.id} className={`flex items-start gap-3 card p-4 cursor-pointer ${templateId === t.id ? "border-verified" : ""}`}>
                <input type="radio" name="draft" checked={templateId === t.id} onChange={() => setTemplateId(t.id)} className="mt-1" />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-navy">
                    <FileText size={14} aria-hidden /> Template: {t.name}
                  </span>
                  <span className="block text-xs text-ink-soft truncate">{t.subject}</span>
                </span>
              </label>
            ))}
            <p className="text-xs text-ink-soft">
              Templates support {"{{investorName}}"}, {"{{firm}}"}, {"{{companyName}}"}, {"{{founderName}}"}, {"{{matchReason}}"}, {"{{askAmount}}"}.{" "}
              <Link href="/dashboard/outreach/templates" className="text-verified hover:underline">
                Manage templates
              </Link>
            </p>
            <div className="flex justify-between">
              <button className="btn-secondary" onClick={() => setStep(0)}>
                Back
              </button>
              <button className="btn-primary" onClick={() => setStep(2)}>
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <h2 className="font-display text-lg">Review and create</h2>
            <FormField label="Campaign name" optional>
              {(p) => <input className="input-field" {...p} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder={`${company?.name ?? "Seed"} outreach`} />}
            </FormField>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div className="card p-3">
                <dt className="label">Recipients</dt>
                <dd className="font-display text-xl text-navy">{recipients.length}</dd>
              </div>
              <div className="card p-3">
                <dt className="label">Drafting</dt>
                <dd className="text-navy">{templateId ? templates.find((t) => t.id === templateId)?.name : "AI personalized"}</dd>
              </div>
            </dl>
            <p className="text-xs text-ink-soft">This creates a draft campaign. Nothing is sent until you review the drafts, launch, and send a batch.</p>
            <div className="flex justify-between">
              <button className="btn-secondary" onClick={() => setStep(1)} disabled={creating}>
                Back
              </button>
              <button className="btn-primary" onClick={create} disabled={creating || recipients.length === 0}>
                {creating ? `Drafting ${recipients.length} emails…` : "Create drafts"}
              </button>
            </div>
          </div>
        )}
      </div>
    </Page>
  );
}
