"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, UserRound } from "lucide-react";
import toast from "react-hot-toast";
import { api, errorMessage } from "@/lib/api";
import { ChoiceChips, FormField, TagInput } from "@/components/ui";
import { ConfirmationDialog } from "@/components/ui/overlays";
import { SaveStatus, useAutosave } from "./useAutosave";
import {
  BUSINESS_TYPE_LABELS,
  Founder,
  FUNDING_STAGE_LABELS,
  INDUSTRIES,
  INSTRUMENT_LABELS,
  INVESTOR_TYPE_LABELS,
  label,
  MetricQuestion,
  PRODUCT_STAGE_LABELS,
  Profile,
  SKILL_LABELS,
} from "./types";

export type FlushRef = React.MutableRefObject<(() => Promise<boolean>) | null>;

interface EditorProps {
  profile: Profile;
  onSaved: (p: Profile) => void;
  flushRef?: FlushRef;
}

const num = (v: string): number | null => (v.trim() === "" ? null : Number(v.replace(/[, ]/g, "")));
const str = (v: unknown) => (v == null ? "" : String(v));
const fieldId = (k: string) => `field-${k}`;

function useSection<T>(profile: Profile, section: string, initial: T, toPayload: (v: T) => unknown, onSaved: (p: Profile) => void, flushRef?: FlushRef) {
  const [value, setValue] = useState<T>(initial);
  const { state, flush } = useAutosave(value, async (v) => onSaved(await api.put<Profile>(`/api/company-profile/${profile.id}/sections/${section}`, toPayload(v))));
  useEffect(() => {
    if (flushRef) flushRef.current = flush;
  }, [flushRef, flush]);
  return { value, setValue, state };
}

function Header({ title, description, state }: { title: string; description: string; state: ReturnType<typeof useAutosave>["state"] }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-6">
      <div>
        <h2 className="font-display text-xl">{title}</h2>
        <p className="text-sm text-ink-soft mt-1 max-w-xl">{description}</p>
      </div>
      <div className="shrink-0 sm:pt-1">
        <SaveStatus state={state} />
      </div>
    </div>
  );
}

const errFor = (state: { status: string; field?: string; message?: string }, key: string) => (state.status === "error" && state.field === key ? state.message : null);

function TextArea({ value, onChange, rows = 3, placeholder, ...rest }: { value: string; onChange: (v: string) => void; rows?: number; placeholder?: string; id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) {
  return <textarea className="input-field" rows={rows} value={value} placeholder={placeholder} maxLength={4000} onChange={(e) => onChange(e.target.value)} {...rest} />;
}

// ---------------------------------------------------------------------------------------
// Step 1 — Founders
// ---------------------------------------------------------------------------------------
export function FoundersEditor({ profile, onSaved }: EditorProps) {
  const [openId, setOpenId] = useState<string | null>(profile.founders[0]?.id ?? null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Founder | null>(null);

  async function reload() {
    onSaved(await api.get<Profile>(`/api/company-profile?companyId=${profile.id}`));
  }

  async function addFounder() {
    setAdding(true);
    try {
      const f = await api.post<Founder>(`/api/company-profile/${profile.id}/founders`, { fullName: "New co-founder", skills: [] });
      await reload();
      setOpenId(f.id);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't add a co-founder."));
    } finally {
      setAdding(false);
    }
  }

  async function remove() {
    if (!removing) return;
    try {
      await api.delete(`/api/company-profile/${profile.id}/founders/${removing.id}`);
      await reload();
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't remove."));
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="font-display text-xl">Founding team</h2>
        <p className="text-sm text-ink-soft mt-1 max-w-xl">
          Investors back people first. Tell us what makes this team the right one for this problem — it's used to match you with funds that look for
          founders like you.
        </p>
      </div>
      <div className="space-y-3">
        {profile.founders.map((f) => (
          <div key={f.id} className="card">
            <button
              type="button"
              onClick={() => setOpenId(openId === f.id ? null : f.id)}
              aria-expanded={openId === f.id}
              className="w-full flex items-center justify-between gap-3 p-4 text-left"
            >
              <span className="flex items-center gap-3 min-w-0">
                <span className="w-9 h-9 rounded-full bg-verified-soft text-verified flex items-center justify-center shrink-0" aria-hidden>
                  <UserRound size={16} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-navy truncate">{f.fullName}</span>
                  <span className="block text-xs text-ink-soft truncate">
                    {[f.role, f.isAccountHolder ? "You" : null].filter(Boolean).join(" · ") || "Add role"}
                  </span>
                </span>
              </span>
              <span className="text-xs text-verified shrink-0">{openId === f.id ? "Close" : "Edit"}</span>
            </button>
            {openId === f.id && (
              <div className="border-t border-line-soft p-4 sm:p-5">
                <FounderForm companyId={profile.id} founder={f} onSaved={reload} />
                {!f.isAccountHolder && (
                  <button type="button" className="btn-ghost text-danger mt-4 inline-flex items-center gap-1.5" onClick={() => setRemoving(f)}>
                    <Trash2 size={14} aria-hidden /> Remove {f.fullName}
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {profile.founders.length < 8 && (
        <button type="button" className="btn-secondary mt-4 inline-flex items-center gap-1.5" onClick={addFounder} disabled={adding}>
          <Plus size={14} aria-hidden /> {adding ? "Adding…" : "Add a co-founder"}
        </button>
      )}
      <ConfirmationDialog
        open={!!removing}
        title="Remove co-founder?"
        message={`${removing?.fullName}'s profile will be removed from this company.`}
        confirmLabel="Remove"
        destructive
        onConfirm={remove}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}

function FounderForm({ companyId, founder, onSaved }: { companyId: string; founder: Founder; onSaved: () => Promise<void> }) {
  const [f, setF] = useState(founder);
  const { state } = useAutosave(f, async (v) => {
    const { id: _id, isAccountHolder: _a, ...payload } = v;
    await api.put(`/api/company-profile/${companyId}/founders/${founder.id}`, payload);
    await onSaved();
  });
  const set = (k: keyof Founder) => (v: any) => setF({ ...f, [k]: v });
  const text = (k: keyof Founder, labelText: string, opts: { optional?: boolean; placeholder?: string; hint?: string; area?: boolean } = {}) => (
    <FormField label={labelText} optional={opts.optional} hint={opts.hint} error={errFor(state, k)}>
      {(p) =>
        opts.area ? (
          <TextArea {...p} value={str(f[k])} onChange={set(k)} placeholder={opts.placeholder} />
        ) : (
          <input className="input-field" {...p} value={str(f[k])} onChange={(e) => set(k)(e.target.value)} placeholder={opts.placeholder} />
        )
      }
    </FormField>
  );
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <SaveStatus state={state} />
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        {text("fullName", "Full name")}
        {text("role", "Role", { placeholder: "CEO, CTO, Head of Product…" })}
        {text("linkedinUrl", "LinkedIn", { optional: true, placeholder: "https://www.linkedin.com/in/…" })}
        {text("location", "Location", { optional: true, placeholder: "Bengaluru, India" })}
      </div>
      {text("experience", "Professional experience", { area: true, placeholder: "8 years building payments infrastructure at HDFC; led a team of 12." })}
      {text("previousCompanies", "Previous startups or companies", { optional: true, area: true })}
      {text("education", "Education", { optional: true, placeholder: "B.Tech, IIT Madras" })}
      <FormField label="Domain expertise" hint="Press Enter after each one." optional>
        {(p) => <TagInput {...p} value={f.domainExpertise} onChange={set("domainExpertise")} placeholder="payments, credit risk, B2B sales" />}
      </FormField>
      <FormField label="Skills" optional>
        {() => <ChoiceChips label="Skills" options={label(SKILL_LABELS)} value={f.skills} onChange={set("skills")} />}
      </FormField>
      <div className="grid sm:grid-cols-2 gap-4">
        <FormField label="Founded a company before?" optional>
          {() => (
            <ChoiceChips
              label="Previous founder"
              multiple={false}
              options={[
                { value: "yes", label: "Yes" },
                { value: "no", label: "No" },
              ]}
              value={f.previousFounder == null ? [] : [f.previousFounder ? "yes" : "no"]}
              onChange={(v) => set("previousFounder")(v[0] === "yes" ? true : v[0] === "no" ? false : null)}
            />
          )}
        </FormField>
        <FormField label="Commitment" optional>
          {() => (
            <ChoiceChips
              label="Commitment"
              multiple={false}
              options={[
                { value: "FULL_TIME", label: "Full-time" },
                { value: "PART_TIME", label: "Part-time" },
              ]}
              value={f.commitment ? [f.commitment] : []}
              onChange={(v) => set("commitment")(v[0] ?? null)}
            />
          )}
        </FormField>
      </div>
      {text("motivation", "Why are you building this?", { optional: true, area: true })}
      {text("uniqueInsight", "Why is this team uniquely positioned to win?", { optional: true, area: true, hint: "Unfair advantages: insight, access, distribution, technical depth." })}
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Step 2 — Company overview
// ---------------------------------------------------------------------------------------
export function OverviewEditor({ profile, onSaved, flushRef }: EditorProps) {
  const o = profile.overview;
  const { value: v, setValue, state } = useSection(
    profile,
    "overview",
    {
      name: str(o.name),
      website: str(o.website),
      foundedYear: str(o.foundedYear),
      headquarters: str(o.headquarters),
      sector: (o.sector ?? []) as string[],
      subIndustry: (o.subIndustry ?? []) as string[],
      businessType: (o.businessType ?? []) as string[],
      oneLiner: str(o.oneLiner),
      description: str(o.description),
      problem: str(o.problem),
      targetCustomer: str(o.targetCustomer),
      existingAlternatives: str(o.existingAlternatives),
      solution: str(o.solution),
      competitiveAdvantage: str(o.competitiveAdvantage),
      competitors: (o.competitors ?? []) as string[],
    },
    (x) => ({ ...x, foundedYear: num(x.foundedYear) }),
    onSaved,
    flushRef
  );
  const set = (k: keyof typeof v) => (val: any) => setValue({ ...v, [k]: val });
  const input = (k: keyof typeof v, l: string, opts: { optional?: boolean; placeholder?: string; type?: string; hint?: string } = {}) => (
    <FormField label={l} optional={opts.optional} hint={opts.hint} error={errFor(state, k)} id={fieldId(k)}>
      {(p) => <input className="input-field" type={opts.type ?? "text"} {...p} value={v[k] as string} onChange={(e) => set(k)(e.target.value)} placeholder={opts.placeholder} />}
    </FormField>
  );
  const area = (k: keyof typeof v, l: string, opts: { optional?: boolean; placeholder?: string; hint?: string } = {}) => (
    <FormField label={l} optional={opts.optional} hint={opts.hint} error={errFor(state, k)} id={fieldId(k)}>
      {(p) => <TextArea {...p} value={v[k] as string} onChange={set(k)} placeholder={opts.placeholder} />}
    </FormField>
  );

  return (
    <div>
      <Header title="Company overview" description="What you do, for whom, and why it wins. Short, specific answers make for better matches and better emails." state={state} />
      <div className="space-y-5">
        <div className="grid sm:grid-cols-2 gap-4">
          {input("name", "Company name")}
          {input("website", "Website", { optional: true, placeholder: "https://velopay.com" })}
          {input("headquarters", "Headquarters", { placeholder: "India" })}
          {input("foundedYear", "Founding year", { optional: true, type: "number", placeholder: "2024" })}
        </div>
        {input("oneLiner", "One-line description", { placeholder: "Instant cross-border payouts for freelancers", hint: "Under 200 characters." })}
        <FormField label="Industry" hint="Pick or type. Used directly in investor matching." error={errFor(state, "sector")} id={fieldId("sector")}>
          {(p) => (
            <div className="space-y-2">
              <TagInput {...p} value={v.sector} onChange={set("sector")} placeholder="Fintech" />
              <div className="flex flex-wrap gap-1.5">
                {INDUSTRIES.filter((i) => !v.sector.includes(i)).slice(0, 10).map((i) => (
                  <button key={i} type="button" className="chip hover:border-ink-soft" onClick={() => set("sector")([...v.sector, i])}>
                    + {i}
                  </button>
                ))}
              </div>
            </div>
          )}
        </FormField>
        <FormField label="Sub-industry" optional hint="More specific is better: “cross-border payments”, “B2B payroll”." id={fieldId("subIndustry")}>
          {(p) => <TagInput {...p} value={v.subIndustry} onChange={set("subIndustry")} placeholder="cross-border payments" />}
        </FormField>
        <FormField label="Business type" error={errFor(state, "businessType")} id={fieldId("businessType")} hint="Choose up to four.">
          {() => <ChoiceChips label="Business type" options={label(BUSINESS_TYPE_LABELS)} value={v.businessType} onChange={(x) => set("businessType")(x.slice(0, 4))} />}
        </FormField>
        {area("problem", "Problem", { placeholder: "Freelancers in India wait 7–21 days and lose 4–6% to fees when paid from abroad." })}
        {area("targetCustomer", "Target customer", { optional: true, placeholder: "Indian freelancers billing US/EU clients, $2k–20k/month" })}
        {area("existingAlternatives", "How do they solve it today?", { optional: true, placeholder: "PayPal, wire transfers, Wise" })}
        {area("solution", "Your solution", { placeholder: "Same-day payouts at a flat 1% fee via local rails." })}
        {area("competitiveAdvantage", "Competitive advantage", { optional: true })}
        <FormField label="Main competitors" optional>
          {(p) => <TagInput {...p} value={v.competitors} onChange={set("competitors")} placeholder="Wise, Payoneer" />}
        </FormField>
        {area("description", "Detailed description", { optional: true, hint: "Anything investors should know that didn't fit above." })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Step 3 — Product & market
// ---------------------------------------------------------------------------------------
export function ProductMarketEditor({ profile, onSaved, flushRef }: EditorProps) {
  const pm = profile.productMarket;
  const { value: v, setValue, state } = useSection(
    profile,
    "productMarket",
    {
      productStage: str(pm.productStage),
      productUrl: str(pm.productUrl),
      productDescription: str(pm.productDescription),
      customerProfile: str(pm.customerProfile),
      tamUsd: str(pm.tamUsd),
      samUsd: str(pm.samUsd),
      somUsd: str(pm.somUsd),
      marketSizeSource: str(pm.marketSizeSource),
      targetGeographies: (pm.targetGeographies ?? []) as string[],
      businessModel: str(pm.businessModel),
      pricingModel: str(pm.pricingModel),
      distributionStrategy: str(pm.distributionStrategy),
      technologyDifferentiation: str(pm.technologyDifferentiation),
      replicationBarriers: str(pm.replicationBarriers),
    },
    (x) => ({ ...x, productStage: x.productStage || null, tamUsd: num(x.tamUsd), samUsd: num(x.samUsd), somUsd: num(x.somUsd) }),
    onSaved,
    flushRef
  );
  const [showMarket, setShowMarket] = useState(!!(pm.tamUsd || pm.samUsd || pm.somUsd));
  const set = (k: keyof typeof v) => (val: any) => setValue({ ...v, [k]: val });
  const area = (k: keyof typeof v, l: string, opts: { optional?: boolean; placeholder?: string; hint?: string } = {}) => (
    <FormField label={l} optional={opts.optional} hint={opts.hint} error={errFor(state, k)} id={fieldId(k)}>
      {(p) => <TextArea {...p} value={v[k] as string} onChange={set(k)} placeholder={opts.placeholder} rows={2} />}
    </FormField>
  );

  return (
    <div>
      <Header title="Product and market" description="Where the product is today and the market it sells into." state={state} />
      <div className="space-y-5">
        <FormField label="Product stage" error={errFor(state, "productStage")} id={fieldId("productStage")} hint="This decides which traction questions we ask next.">
          {() => <ChoiceChips label="Product stage" multiple={false} options={label(PRODUCT_STAGE_LABELS)} value={v.productStage ? [v.productStage] : []} onChange={(x) => set("productStage")(x[0] ?? "")} />}
        </FormField>
        <FormField label="Target geography" error={errFor(state, "targetGeographies")} id={fieldId("targetGeographies")} hint="Markets you sell into. Used for investor geography matching.">
          {(p) => <TagInput {...p} value={v.targetGeographies} onChange={set("targetGeographies")} placeholder="India, Southeast Asia" />}
        </FormField>
        <FormField label="Product or demo URL" optional error={errFor(state, "productUrl")}>
          {(p) => <input className="input-field" {...p} value={v.productUrl} onChange={(e) => set("productUrl")(e.target.value)} placeholder="https://app.velopay.com" />}
        </FormField>
        {area("productDescription", "What the product does", { optional: true })}
        {area("businessModel", "Business model", { optional: true, placeholder: "1% take on each payout", hint: "How you make money." })}
        {area("pricingModel", "Pricing", { optional: true, placeholder: "Free up to $1k/month, then 1%" })}
        {area("distributionStrategy", "Distribution strategy", { optional: true, placeholder: "Freelancer communities, Upwork partnerships" })}
        {area("technologyDifferentiation", "Technology or IP differentiation", { optional: true })}
        {area("replicationBarriers", "What makes this hard to copy?", { optional: true })}
        <div className="border-t border-line-soft pt-4">
          {!showMarket ? (
            <button type="button" className="text-sm text-verified hover:underline" onClick={() => setShowMarket(true)}>
              + Add market size (TAM / SAM / SOM)
            </button>
          ) : (
            <div className="space-y-4">
              <p className="text-xs text-ink-soft">
                Optional. Only enter figures you can source — investors check them. TAM is the whole market; SAM the part you can serve; SOM what you can
                realistically win in 3–5 years.
              </p>
              <div className="grid sm:grid-cols-3 gap-4">
                {(["tamUsd", "samUsd", "somUsd"] as const).map((k) => (
                  <FormField key={k} label={`${k.slice(0, 3).toUpperCase()} (USD)`} optional error={errFor(state, k)}>
                    {(p) => <input className="input-field" inputMode="numeric" {...p} value={v[k]} onChange={(e) => set(k)(e.target.value)} placeholder="2,000,000,000" />}
                  </FormField>
                ))}
              </div>
              <FormField label="Source" optional>
                {(p) => <input className="input-field" {...p} value={v.marketSizeSource} onChange={(e) => set("marketSizeSource")(e.target.value)} placeholder="RBI remittance data 2025" />}
              </FormField>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Step 4 — Traction (conditional on business type / industry / product stage)
// ---------------------------------------------------------------------------------------
export function TractionEditor({ profile, onSaved, flushRef }: EditorProps) {
  const [questions, setQuestions] = useState<MetricQuestion[] | null>(null);
  const ctx = useMemo(
    () => ({
      businessTypes: (profile.overview.businessType ?? []).join(","),
      industries: [...(profile.overview.sector ?? []), ...(profile.overview.subIndustry ?? [])].join(","),
      productStage: profile.productMarket.productStage ?? "",
    }),
    [profile.overview.businessType, profile.overview.sector, profile.overview.subIndustry, profile.productMarket.productStage]
  );
  useEffect(() => {
    const qs = new URLSearchParams(ctx);
    api.get<{ traction: MetricQuestion[] }>(`/api/company-profile/questions?${qs}`).then((r) => setQuestions(r.traction)).catch(() => setQuestions([]));
  }, [ctx]);

  const initial = Object.fromEntries(Object.entries(profile.traction).map(([k, x]) => [k, str(x)])) as Record<string, string>;
  const { value: v, setValue, state } = useSection(
    profile,
    "traction",
    initial,
    (x) => {
      const out: Record<string, number | string> = {};
      for (const [k, val] of Object.entries(x)) {
        if (val.trim() === "") continue;
        const q = questions?.find((qq) => qq.key === k);
        out[k] = q && q.kind !== "text" ? Number(val.replace(/[, %$]/g, "")) : val;
      }
      return out;
    },
    onSaved,
    flushRef
  );
  const [showSensitive, setShowSensitive] = useState(Object.keys(initial).some((k) => questions?.find((q) => q.key === k)?.sensitive));
  if (!questions) return <p className="text-sm text-ink-soft">Loading questions…</p>;
  const open = questions.filter((q) => !q.sensitive);
  const sensitive = questions.filter((q) => q.sensitive);
  const preRevenue = ["IDEA", "PROTOTYPE"].includes(profile.productMarket.productStage);

  const field = (q: MetricQuestion) => (
    <FormField key={q.key} label={q.label} hint={q.help} optional sensitive={q.sensitive} error={errFor(state, q.key)} id={fieldId(q.key)}>
      {(p) =>
        q.kind === "text" ? (
          <TextArea {...p} rows={2} value={v[q.key] ?? ""} onChange={(x) => setValue({ ...v, [q.key]: x })} />
        ) : (
          <div className="relative">
            {q.kind === "currency" && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-soft">$</span>}
            <input
              className={`input-field ${q.kind === "currency" ? "pl-7" : ""}`}
              inputMode="decimal"
              {...p}
              value={v[q.key] ?? ""}
              onChange={(e) => setValue({ ...v, [q.key]: e.target.value })}
            />
            {q.kind === "percent" && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-soft">%</span>}
          </div>
        )
      }
    </FormField>
  );

  return (
    <div>
      <Header
        title={preRevenue ? "Validation so far" : "Traction"}
        description={
          preRevenue
            ? "No revenue yet is fine. Investors at your stage look for evidence that the problem is real and people want your solution."
            : "Questions are tailored to your business model. Every field is optional — share what you're comfortable with."
        }
        state={state}
      />
      {!profile.productMarket.productStage && <p className="text-xs text-signal mb-4">Set your product stage in the previous step to see the most relevant questions.</p>}
      <div className="grid sm:grid-cols-2 gap-4">{open.map(field)}</div>
      {sensitive.length > 0 && (
        <div className="mt-6 border-t border-line-soft pt-5">
          {!showSensitive ? (
            <button type="button" className="text-sm text-verified hover:underline" onClick={() => setShowSensitive(true)}>
              + Add financials (revenue, burn, runway) — confidential
            </button>
          ) : (
            <>
              <p className="text-xs text-ink-soft mb-4">
                Confidential: shown only to you, and never sent to an AI provider unless you allow it in the Documents step.
              </p>
              <div className="grid sm:grid-cols-2 gap-4">{sensitive.map(field)}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Step 5 — Fundraising
// ---------------------------------------------------------------------------------------
export function FundraisingEditor({ profile, onSaved, flushRef }: EditorProps) {
  const f = profile.fundraising;
  const { value: v, setValue, state } = useSection(
    profile,
    "fundraising",
    {
      stage: str(f.stage),
      targetAmountUsd: str(f.targetAmountUsd),
      committedAmountUsd: str(f.committedAmountUsd),
      previouslyRaisedUsd: str(f.previouslyRaisedUsd),
      valuationUsd: str(f.valuationUsd),
      instrument: str(f.instrument),
      closeTimeline: str(f.closeTimeline),
      useOfFunds: ((f.useOfFunds ?? []) as { category: string; percent: number }[]).map((u) => ({ category: u.category, percent: String(u.percent) })),
      milestones: str(f.milestones),
      existingInvestors: str(f.existingInvestors),
      leadInvestor: str(f.leadInvestor),
    },
    (x) => {
      const uses = x.useOfFunds.filter((u) => u.category.trim() && u.percent !== "");
      return {
        ...x,
        stage: x.stage || null,
        instrument: x.instrument || null,
        targetAmountUsd: num(x.targetAmountUsd),
        committedAmountUsd: num(x.committedAmountUsd),
        previouslyRaisedUsd: num(x.previouslyRaisedUsd),
        valuationUsd: num(x.valuationUsd),
        // Only send use-of-funds once it adds up, so a half-typed allocation doesn't error.
        useOfFunds: uses.reduce((s, u) => s + Number(u.percent), 0) === 100 ? uses.map((u) => ({ category: u.category, percent: Number(u.percent) })) : undefined,
      };
    },
    onSaved,
    flushRef
  );
  const set = (k: keyof typeof v) => (val: any) => setValue({ ...v, [k]: val });
  const total = v.useOfFunds.reduce((s, u) => s + (Number(u.percent) || 0), 0);
  const EXAMPLES: Record<string, string> = { targetAmountUsd: "500,000", committedAmountUsd: "e.g. 150,000", previouslyRaisedUsd: "e.g. 100,000", valuationUsd: "e.g. 6,000,000" };
  const moneyField = (k: "targetAmountUsd" | "committedAmountUsd" | "previouslyRaisedUsd" | "valuationUsd", l: string, opts: { optional?: boolean; hint?: string } = {}) => (
    <FormField label={l} optional={opts.optional} hint={opts.hint} error={errFor(state, k)} id={fieldId(k)} sensitive={k === "valuationUsd"}>
      {(p) => (
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-soft">$</span>
          <input className="input-field pl-7" inputMode="numeric" {...p} value={v[k]} onChange={(e) => set(k)(e.target.value)} placeholder={EXAMPLES[k]} />
        </div>
      )}
    </FormField>
  );

  return (
    <div>
      <Header title="Fundraising" description="The round you're raising now. Stage and amount drive which investors are eligible." state={state} />
      <div className="space-y-5">
        <FormField label="Funding stage" error={errFor(state, "stage")} id={fieldId("stage")}>
          {() => <ChoiceChips label="Funding stage" multiple={false} options={label(FUNDING_STAGE_LABELS)} value={v.stage ? [v.stage] : []} onChange={(x) => set("stage")(x[0] ?? "")} />}
        </FormField>
        <div className="grid sm:grid-cols-2 gap-4">
          {moneyField("targetAmountUsd", "Target raise (USD)")}
          {moneyField("committedAmountUsd", "Already committed", { optional: true })}
          {moneyField("previouslyRaisedUsd", "Raised before this round", { optional: true })}
          {moneyField("valuationUsd", "Valuation / cap", { optional: true, hint: "Leave blank if you'd rather not share it yet." })}
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <FormField label="Instrument" optional>
            {(p) => (
              <select className="input-field" {...p} value={v.instrument} onChange={(e) => set("instrument")(e.target.value)}>
                <option value="">Not decided</option>
                {Object.entries(INSTRUMENT_LABELS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField label="Expected close" optional>
            {(p) => <input className="input-field" {...p} value={v.closeTimeline} onChange={(e) => set("closeTimeline")(e.target.value)} placeholder="Within 3 months" />}
          </FormField>
        </div>
        <FormField label="Use of funds" optional hint="Percentages must add up to 100." error={errFor(state, "useOfFunds")} id={fieldId("useOfFunds")}>
          {() => (
            <div className="space-y-2">
              {v.useOfFunds.map((u, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    className="input-field"
                    aria-label={`Use of funds category ${i + 1}`}
                    value={u.category}
                    placeholder="Engineering"
                    onChange={(e) => set("useOfFunds")(v.useOfFunds.map((x, j) => (j === i ? { ...x, category: e.target.value } : x)))}
                  />
                  <div className="relative w-28 shrink-0">
                    <input
                      className="input-field pr-7"
                      inputMode="numeric"
                      aria-label={`Use of funds percent ${i + 1}`}
                      value={u.percent}
                      onChange={(e) => set("useOfFunds")(v.useOfFunds.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)))}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-soft">%</span>
                  </div>
                  <button type="button" className="btn-ghost px-2" aria-label="Remove row" onClick={() => set("useOfFunds")(v.useOfFunds.filter((_, j) => j !== i))}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <div className="flex items-center justify-between">
                <button type="button" className="text-sm text-verified hover:underline" onClick={() => set("useOfFunds")([...v.useOfFunds, { category: "", percent: "" }])}>
                  + Add category
                </button>
                {v.useOfFunds.length > 0 && <span className={`text-xs font-mono ${total === 100 ? "text-verified" : "text-signal"}`}>{total}% / 100%</span>}
              </div>
            </div>
          )}
        </FormField>
        <FormField label="Milestones this round will fund" optional>
          {(p) => <TextArea {...p} value={v.milestones} onChange={set("milestones")} placeholder="Reach $100k MRR, launch in UAE, hire 4 engineers" />}
        </FormField>
        <div className="grid sm:grid-cols-2 gap-4">
          <FormField label="Existing investors" optional>
            {(p) => <input className="input-field" {...p} value={v.existingInvestors} onChange={(e) => set("existingInvestors")(e.target.value)} />}
          </FormField>
          <FormField label="Lead investor (if any)" optional>
            {(p) => <input className="input-field" {...p} value={v.leadInvestor} onChange={(e) => set("leadInvestor")(e.target.value)} />}
          </FormField>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Step 6 — Investor preferences
// ---------------------------------------------------------------------------------------
export function PreferencesEditor({ profile, onSaved, flushRef }: EditorProps) {
  const pr = profile.preferences;
  const { value: v, setValue, state } = useSection(
    profile,
    "preferences",
    {
      stages: (pr.stages ?? []) as string[],
      investorTypes: (pr.investorTypes ?? []) as string[],
      sectors: (pr.sectors ?? []) as string[],
      geographies: (pr.geographies ?? []) as string[],
      minCheckUsd: str(pr.minCheckUsd),
      maxCheckUsd: str(pr.maxCheckUsd),
      leadPreference: str(pr.leadPreference),
      strategicValue: str(pr.strategicValue),
      previouslyContactedFunds: (pr.previouslyContactedFunds ?? []) as string[],
      excludedInvestors: (pr.excludedInvestors ?? []) as string[],
      excludedSectors: (pr.excludedSectors ?? []) as string[],
    },
    (x) => ({ ...x, minCheckUsd: num(x.minCheckUsd), maxCheckUsd: num(x.maxCheckUsd), leadPreference: x.leadPreference || null }),
    onSaved,
    flushRef
  );
  const set = (k: keyof typeof v) => (val: any) => setValue({ ...v, [k]: val });

  return (
    <div>
      <Header
        title="Investor preferences"
        description="Who you'd like to raise from. These shape ranking and explanations; only exclusions remove investors from your matches."
        state={state}
      />
      <div className="space-y-5">
        <FormField label="Preferred investor types" optional>
          {() => <ChoiceChips label="Investor types" options={label(INVESTOR_TYPE_LABELS)} value={v.investorTypes} onChange={set("investorTypes")} />}
        </FormField>
        <FormField label="Stages they typically invest at" optional>
          {() => <ChoiceChips label="Stages" options={label(FUNDING_STAGE_LABELS)} value={v.stages} onChange={set("stages")} />}
        </FormField>
        <div className="grid sm:grid-cols-2 gap-4">
          {(["minCheckUsd", "maxCheckUsd"] as const).map((k) => (
            <FormField key={k} label={k === "minCheckUsd" ? "Minimum check (USD)" : "Maximum check (USD)"} optional error={errFor(state, k)} id={fieldId(k)}>
              {(p) => (
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-soft">$</span>
                  <input className="input-field pl-7" inputMode="numeric" {...p} value={v[k]} onChange={(e) => set(k)(e.target.value)} placeholder={k === "minCheckUsd" ? "50,000" : "250,000"} />
                </div>
              )}
            </FormField>
          ))}
        </div>
        <FormField label="Lead or follow?" optional>
          {() => (
            <ChoiceChips
              label="Lead preference"
              multiple={false}
              options={[
                { value: "LEAD", label: "Looking for a lead" },
                { value: "FOLLOW", label: "Have a lead, need followers" },
                { value: "EITHER", label: "Either" },
              ]}
              value={v.leadPreference ? [v.leadPreference] : []}
              onChange={(x) => set("leadPreference")(x[0] ?? "")}
            />
          )}
        </FormField>
        <FormField label="Strategic value you'd like" optional>
          {(p) => <TextArea {...p} rows={2} value={v.strategicValue} onChange={set("strategicValue")} placeholder="Banking partnerships, US market intros" />}
        </FormField>
        <FormField label="Funds you've already pitched" optional hint="Flagged in your matches so you don't double-pitch.">
          {(p) => <TagInput {...p} max={100} value={v.previouslyContactedFunds} onChange={set("previouslyContactedFunds")} placeholder="Fund name" />}
        </FormField>
        <div className="border-t border-line-soft pt-5 space-y-4">
          <p className="text-xs text-ink-soft">Exclusions are hard filters: these investors and sectors never appear in your matches.</p>
          <FormField label="Exclude investors or funds" optional>
            {(p) => <TagInput {...p} max={100} value={v.excludedInvestors} onChange={set("excludedInvestors")} placeholder="Name or fund" />}
          </FormField>
          <FormField label="Exclude investors focused only on" optional>
            {(p) => <TagInput {...p} value={v.excludedSectors} onChange={set("excludedSectors")} placeholder="crypto, gambling" />}
          </FormField>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Step 7 — Documents
// ---------------------------------------------------------------------------------------
export function DocumentsEditor({ profile, onSaved, flushRef }: EditorProps) {
  const d = profile.documents;
  const { value: v, setValue, state } = useSection(
    profile,
    "documents",
    { demoUrl: str(d.demoUrl), videoUrl: str(d.videoUrl), financialModelUrl: str(d.financialModelUrl) },
    (x) => x,
    onSaved,
    flushRef
  );
  const [uploading, setUploading] = useState(false);
  const [consent, setConsent] = useState(profile.aiFinancialsConsent);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) return toast.error("Deck files must be 25 MB or smaller.");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("deck", file);
      await api.postForm(`/api/decks/${profile.id}/upload`, fd);
      onSaved(await api.get<Profile>(`/api/company-profile?companyId=${profile.id}`));
      toast.success("Deck uploaded.");
    } catch (err) {
      toast.error(errorMessage(err, "Upload failed."));
    } finally {
      setUploading(false);
    }
  }

  async function toggleConsent(next: boolean) {
    setConsent(next);
    try {
      await api.put(`/api/company-profile/${profile.id}/ai-consent`, { consent: next });
    } catch (err) {
      setConsent(!next);
      toast.error(errorMessage(err, "Couldn't update."));
    }
  }

  return (
    <div>
      <Header title="Documents" description="Your deck and supporting links. Founder LinkedIn profiles are added in the Founders step." state={state} />
      <div className="space-y-5">
        <div className="card p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-navy">Pitch deck</p>
            <p className="text-xs text-ink-soft">{profile.deck ? `${profile.deck.fileName ?? "Generated deck"} · version ${profile.deck.version}` : "PDF or PPTX, up to 25 MB. Optional, but strongly recommended."}</p>
          </div>
          <label className={`btn-secondary text-sm cursor-pointer text-center ${uploading ? "opacity-60 pointer-events-none" : ""}`}>
            {uploading ? "Uploading…" : profile.deck ? "Replace deck" : "Upload deck"}
            <input type="file" accept=".pdf,.pptx" className="sr-only" onChange={upload} disabled={uploading} />
          </label>
        </div>
        {(
          [
            ["demoUrl", "Product demo URL", "https://loom.com/share/…"],
            ["videoUrl", "Company overview video", "https://youtube.com/…"],
            ["financialModelUrl", "Financial model link", "https://docs.google.com/spreadsheets/…"],
          ] as const
        ).map(([k, l, ph]) => (
          <FormField key={k} label={l} optional error={errFor(state, k)} id={fieldId(k)}>
            {(p) => <input className="input-field" {...p} value={v[k]} onChange={(e) => setValue({ ...v, [k]: e.target.value })} placeholder={ph} />}
          </FormField>
        ))}
        <label className="flex items-start gap-3 card p-4 cursor-pointer">
          <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => toggleConsent(e.target.checked)} />
          <span className="text-sm">
            <span className="font-medium text-navy">Include confidential financials in the AI summary</span>
            <span className="block text-xs text-ink-soft mt-0.5">
              Off by default. When off, revenue, burn, runway and valuation figures are withheld from the AI provider; your deck file and Gmail are never
              sent.
            </span>
          </span>
        </label>
      </div>
    </div>
  );
}
