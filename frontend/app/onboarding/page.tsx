"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";
import { api, ApiError, errorMessage, getStoredUser, getToken, startGmailConnect, StoredUser } from "@/lib/api";

const STAGES = ["IDEA", "PRE_SEED", "SEED", "SERIES_A", "SERIES_B_PLUS"];
const SECTORS = ["Fintech", "SaaS", "Consumer", "Healthtech", "Climate", "AI/ML", "Marketplace", "Deeptech", "Other"];
const COUNTRIES = ["India", "United States", "United Kingdom", "Singapore", "UAE", "Other"];
const STEP_LABELS = ["Company", "Stage", "Sector", "Country", "Raise amount", "Deck", "Connect Gmail", "Finish"];

const EMPTY_FORM = { name: "", oneLiner: "", problem: "", solution: "", stage: "SEED", sector: "", geography: "", askAmountUsd: "" };
type Draft = { step: number; companyId: string | null; deckDone: boolean; form: typeof EMPTY_FORM };

// Progress survives refreshes and the round-trip to Google for Gmail. Keyed per user so a
// shared browser never shows one founder another's draft.
const draftKey = (userId: string) => `gopitch_onboarding_${userId}`;

function loadDraft(userId: string): Draft | null {
  try {
    const raw = localStorage.getItem(draftKey(userId));
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

export default function OnboardingPage() {
  const router = useRouter();
  const [user, setUser] = useState<StoredUser | null>(null);
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [deckStatus, setDeckStatus] = useState<{ generationAvailable: boolean; planAllowsGeneration: boolean } | null>(null);
  const [deckDone, setDeckDone] = useState(false);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  useEffect(() => {
    const stored = getStoredUser();
    if (!getToken() || !stored) {
      router.replace("/login?next=/onboarding");
      return;
    }
    api
      .get<StoredUser>("/api/auth/me")
      .then((me) => {
        if (me.role === "ADMIN") return router.replace("/admin");
        const draft = loadDraft(me.id);
        // Existing founders aren't pushed through onboarding again.
        if (me.hasCompany && !draft) return router.replace("/dashboard");
        setUser(me);
        if (draft) {
          setStep(draft.step);
          setCompanyId(draft.companyId);
          setDeckDone(draft.deckDone);
          setForm({ ...EMPTY_FORM, ...draft.form });
        }
        setReady(true);
      })
      .catch(() => {});
    api.get<{ gmailConnected: boolean }>("/api/profile/me").then((p) => setGmailConnected(p.gmailConnected)).catch(() => {});
  }, [router]);

  useEffect(() => {
    if (!user || !ready) return;
    localStorage.setItem(draftKey(user.id), JSON.stringify({ step, companyId, deckDone, form } satisfies Draft));
  }, [user, ready, step, companyId, deckDone, form]);

  useEffect(() => {
    if (companyId && step === 5 && !deckStatus) {
      api.get<{ generationAvailable: boolean; planAllowsGeneration: boolean }>("/api/decks/config/status").then(setDeckStatus).catch(() => {});
    }
  }, [companyId, step, deckStatus]);

  const next = () => setStep((s) => Math.min(s + 1, STEP_LABELS.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  async function saveCompanyAndAdvance() {
    const amount = Number(form.askAmountUsd);
    if (!Number.isInteger(amount) || amount <= 0) {
      toast.error("Enter the raise amount as a whole number of US dollars, e.g. 500000.");
      return;
    }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      oneLiner: form.oneLiner.trim(),
      problem: form.problem.trim(),
      solution: form.solution.trim(),
      stage: form.stage,
      sector: [form.sector],
      geography: [form.geography],
      askAmountUsd: amount,
    };
    try {
      // Going Back and then Next again updates the same company instead of creating a duplicate.
      if (companyId) {
        await api.patch(`/api/companies/${companyId}`, payload);
      } else {
        const company = await api.post<{ id: string }>("/api/companies", payload);
        setCompanyId(company.id);
      }
      next();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't save company info.");
    } finally {
      setSaving(false);
    }
  }

  async function connectGmail() {
    setConnecting(true);
    try {
      await startGmailConnect("/onboarding");
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't start Gmail connection."));
      setConnecting(false);
    }
  }

  function finish() {
    if (user) localStorage.removeItem(draftKey(user.id));
    router.push(companyId ? `/company/${companyId}` : "/dashboard");
  }

  if (!ready) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-ink-soft">Loading…</div>;
  }

  return (
    <div className="min-h-screen flex flex-col items-center px-4 sm:px-6 py-12">
      <div className="w-full max-w-lg">
        <div className="flex gap-1 mb-8" aria-hidden>
          {STEP_LABELS.map((_, i) => (
            <div key={i} className={`h-0.5 flex-1 rounded-full ${i <= step ? "bg-verified" : "bg-line"}`} />
          ))}
        </div>
        <p className="label mb-6">
          Step {step + 1} of {STEP_LABELS.length} · {STEP_LABELS[step]}
        </p>

        {step === 0 && (
          <StepCard title="Tell us about your company">
            <Field label="Company name *">
              <input autoFocus maxLength={120} className="input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Velo Pay" />
            </Field>
            <Field label="One-line description *">
              <input maxLength={200} className="input-field" value={form.oneLiner} onChange={(e) => setForm({ ...form, oneLiner: e.target.value })} placeholder="Cross-border payments infra for freelancers" />
            </Field>
            <Field label="What problem are you solving? *">
              <textarea rows={3} maxLength={4000} className="input-field" value={form.problem} onChange={(e) => setForm({ ...form, problem: e.target.value })} />
            </Field>
            <Field label="How do you solve it? *">
              <textarea rows={3} maxLength={4000} className="input-field" value={form.solution} onChange={(e) => setForm({ ...form, solution: e.target.value })} />
            </Field>
            <NavButtons onNext={next} nextDisabled={![form.name, form.oneLiner, form.problem, form.solution].every((v) => v.trim())} />
          </StepCard>
        )}

        {step === 1 && (
          <StepCard title="What stage are you at?">
            <div className="grid grid-cols-1 gap-2" role="radiogroup">
              {STAGES.map((s) => (
                <Choice key={s} selected={form.stage === s} onClick={() => setForm({ ...form, stage: s })} className="text-left">
                  {s.replace(/_/g, " ")}
                </Choice>
              ))}
            </div>
            <NavButtons onBack={back} onNext={next} />
          </StepCard>
        )}

        {step === 2 && (
          <StepCard title="What sector are you in?">
            <div className="grid grid-cols-2 gap-2" role="radiogroup">
              {SECTORS.map((s) => (
                <Choice key={s} selected={form.sector === s} onClick={() => setForm({ ...form, sector: s })}>
                  {s}
                </Choice>
              ))}
            </div>
            <p className="text-xs text-ink-soft mt-3">Investor matching uses this. You can refine it later from your company page.</p>
            <NavButtons onBack={back} onNext={next} nextDisabled={!form.sector} />
          </StepCard>
        )}

        {step === 3 && (
          <StepCard title="Where are you based?">
            <div className="grid grid-cols-2 gap-2" role="radiogroup">
              {COUNTRIES.map((c) => (
                <Choice key={c} selected={form.geography === c} onClick={() => setForm({ ...form, geography: c })}>
                  {c}
                </Choice>
              ))}
            </div>
            <NavButtons onBack={back} onNext={next} nextDisabled={!form.geography} />
          </StepCard>
        )}

        {step === 4 && (
          <StepCard title="How much are you raising?">
            <Field label="Amount in USD *">
              <input
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                autoFocus
                className="input-field"
                value={form.askAmountUsd}
                onChange={(e) => setForm({ ...form, askAmountUsd: e.target.value })}
                placeholder="500000"
              />
            </Field>
            {Number(form.askAmountUsd) > 0 && <p className="text-xs text-ink-soft -mt-2">${Number(form.askAmountUsd).toLocaleString()}</p>}
            <NavButtons onBack={back} onNext={saveCompanyAndAdvance} nextDisabled={!form.askAmountUsd} nextLabel={saving ? "Saving…" : "Save & continue"} nextLoading={saving} />
          </StepCard>
        )}

        {step === 5 && companyId && (
          <StepCard title="Your deck">
            <DeckStep companyId={companyId} status={deckStatus} done={deckDone} onDone={() => setDeckDone(true)} />
            <NavButtons onBack={back} onNext={next} nextDisabled={!deckDone} />
          </StepCard>
        )}

        {step === 6 && (
          <StepCard title="Connect Gmail">
            {gmailConnected ? (
              <p className="text-sm text-verified bg-verified-soft rounded px-3 py-2 mb-6">Gmail is connected.</p>
            ) : (
              <p className="text-sm text-ink-soft mb-6">
                Outreach sends from your own Gmail account — never a shared platform address. You can skip this and connect later from
                Settings.
              </p>
            )}
            {!gmailConnected && (
              <button className="btn-primary w-full mb-3" onClick={connectGmail} disabled={connecting}>
                {connecting ? "Redirecting to Google…" : "Connect Gmail"}
              </button>
            )}
            <div className="flex gap-3">
              <button className="btn-secondary flex-1" onClick={back}>
                Back
              </button>
              <button className={gmailConnected ? "btn-primary flex-1" : "btn-secondary flex-1"} onClick={next}>
                {gmailConnected ? "Next" : "Skip for now"}
              </button>
            </div>
          </StepCard>
        )}

        {step === 7 && (
          <StepCard title="You're set up">
            <p className="text-sm text-ink-soft mb-6">
              Your company profile is saved{deckDone ? ", your deck is ready," : ""} and you can see matched investors now.
            </p>
            <button className="btn-primary w-full" onClick={finish}>
              See my investor matches
            </button>
          </StepCard>
        )}

        {step === 5 && !companyId && (
          <StepCard title="Your deck">
            <p className="text-sm text-ink-soft mb-4">We couldn't find your saved company details.</p>
            <button className="btn-primary" onClick={() => setStep(0)}>
              Start again
            </button>
          </StepCard>
        )}

        <p className="text-xs text-ink-soft mt-6 text-center">
          <Link href="/dashboard" className="hover:text-ink">
            Finish later
          </Link>{" "}
          — your progress is saved.
        </p>
      </div>
    </div>
  );
}

function StepCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-6 sm:p-8 animate-fade-up">
      <h1 className="font-display text-2xl mb-6">{title}</h1>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block mb-4">
      <span className="label block mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function Choice({ selected, onClick, children, className = "" }: { selected: boolean; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={`px-4 py-3 rounded border text-sm transition-colors ${className} ${selected ? "border-verified bg-verified-soft" : "border-line hover:border-ink-soft"}`}
    >
      {children}
    </button>
  );
}

function NavButtons({
  onBack,
  onNext,
  nextDisabled,
  nextLabel = "Next",
  nextLoading,
}: {
  onBack?: () => void;
  onNext: () => void;
  nextDisabled?: boolean;
  nextLabel?: string;
  nextLoading?: boolean;
}) {
  return (
    <div className="flex items-center justify-between mt-6">
      {onBack ? (
        <button className="btn-secondary" onClick={onBack}>
          Back
        </button>
      ) : (
        <span />
      )}
      <button className="btn-primary" onClick={onNext} disabled={nextDisabled || nextLoading}>
        {nextLabel}
      </button>
    </div>
  );
}

function DeckStep({
  companyId,
  status,
  done,
  onDone,
}: {
  companyId: string;
  status: { generationAvailable: boolean; planAllowsGeneration: boolean } | null;
  done: boolean;
  onDone: () => void;
}) {
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      await api.post(`/api/decks/${companyId}/generate`);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      setError("Deck files must be 25 MB or smaller.");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("deck", file);
      await api.postForm(`/api/decks/${companyId}/upload`, formData);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  if (done) {
    return <p className="text-sm text-verified bg-verified-soft rounded px-3 py-2 mb-4">Deck ready.</p>;
  }

  return (
    <div className="mb-4">
      {status?.generationAvailable && (
        <button className="btn-primary w-full mb-3" onClick={handleGenerate} disabled={generating || uploading}>
          {generating ? "Generating… (up to a minute)" : "Generate deck with AI"}
        </button>
      )}
      {status && !status.planAllowsGeneration && (
        <p className="text-xs text-ink-soft bg-line-soft rounded px-3 py-2 mb-3">
          The Free plan uses your own deck. AI-guided deck generation is included from{" "}
          <Link href="/pricing" className="text-verified hover:underline">
            Starter
          </Link>
          .
        </p>
      )}
      {status?.planAllowsGeneration && !status.generationAvailable && (
        <p className="text-xs text-signal bg-signal-soft rounded px-3 py-2 mb-3">AI generation isn't available right now — upload your own deck instead.</p>
      )}

      <label className={`btn-secondary w-full text-center cursor-pointer block ${uploading ? "opacity-60 pointer-events-none" : ""}`}>
        {uploading ? "Uploading…" : "Upload deck (PPTX or PDF, max 25 MB)"}
        <input type="file" accept=".pptx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation" className="sr-only" onChange={handleUpload} disabled={uploading} />
      </label>

      {error && (
        <p className="text-sm text-danger mt-3" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
