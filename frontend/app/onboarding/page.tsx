"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { api, ApiError } from "@/lib/api";

const STAGES = ["IDEA", "PRE_SEED", "SEED", "SERIES_A", "SERIES_B_PLUS"];
const SECTORS = ["Fintech", "SaaS", "Consumer", "Healthtech", "Climate", "AI/ML", "Marketplace", "Deeptech", "Other"];
const COUNTRIES = ["India", "United States", "United Kingdom", "Singapore", "UAE", "Other"];

const STEP_LABELS = [
  "Company",
  "Stage",
  "Sector",
  "Country",
  "Raise amount",
  "Deck",
  "Connect Gmail",
  "Finish",
];

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [deckGenAvailable, setDeckGenAvailable] = useState<boolean | null>(null);
  const [deckDone, setDeckDone] = useState(false);
  const [gmailConnected, setGmailConnected] = useState(false);

  const [form, setForm] = useState({
    name: "",
    oneLiner: "",
    problem: "",
    solution: "",
    stage: "SEED",
    sector: "",
    geography: "",
    askAmountUsd: "",
  });

  function next() {
    setStep((s) => Math.min(s + 1, STEP_LABELS.length - 1));
  }
  function back() {
    setStep((s) => Math.max(s - 1, 0));
  }

  async function createCompanyAndAdvance() {
    setSaving(true);
    try {
      const company = await api.post<{ id: string }>("/api/companies", {
        name: form.name,
        oneLiner: form.oneLiner,
        problem: form.problem,
        solution: form.solution,
        stage: form.stage,
        sector: [form.sector],
        geography: [form.geography],
        askAmountUsd: Number(form.askAmountUsd),
      });
      setCompanyId(company.id);
      const status = await api.get<{ generationAvailable: boolean }>("/api/decks/config/status");
      setDeckGenAvailable(status.generationAvailable);
      next();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't save company info.");
    } finally {
      setSaving(false);
    }
  }

  function connectGmail() {
    const token = localStorage.getItem("gopitch_token");
    if (!token) {
      router.push("/login");
      return;
    }
    const apiBase = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:4000";
    if (companyId) localStorage.setItem("gopitch_pending_company_after_gmail", companyId);
    window.location.href = `${apiBase}/auth/google/init?token=${token}`;
  }

  function finish() {
    router.push(companyId ? `/company/${companyId}` : "/dashboard");
  }

  return (
    <div className="min-h-screen flex flex-col items-center px-6 py-12">
      <div className="w-full max-w-lg">
        <div className="flex gap-1 mb-8">
          {STEP_LABELS.map((_, i) => (
            <div key={i} className={`h-0.5 flex-1 rounded-full ${i <= step ? "bg-verified" : "bg-line"}`} />
          ))}
        </div>
        <p className="label mb-6">
          Step {step + 1} of {STEP_LABELS.length} · {STEP_LABELS[step]}
        </p>

        {step === 0 && (
          <StepCard title="Tell us about your company">
            <Field label="Company name">
              <input autoFocus className="input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Velo Pay" />
            </Field>
            <Field label="One-line description">
              <input className="input-field" value={form.oneLiner} onChange={(e) => setForm({ ...form, oneLiner: e.target.value })} placeholder="Cross-border payments infra for freelancers" />
            </Field>
            <Field label="What problem are you solving?">
              <textarea rows={3} className="input-field" value={form.problem} onChange={(e) => setForm({ ...form, problem: e.target.value })} />
            </Field>
            <Field label="How do you solve it?">
              <textarea rows={3} className="input-field" value={form.solution} onChange={(e) => setForm({ ...form, solution: e.target.value })} />
            </Field>
            <NavButtons onNext={next} nextDisabled={!form.name || !form.oneLiner || !form.problem || !form.solution} />
          </StepCard>
        )}

        {step === 1 && (
          <StepCard title="What stage are you at?">
            <div className="grid grid-cols-1 gap-2">
              {STAGES.map((s) => (
                <button
                  key={s}
                  onClick={() => setForm({ ...form, stage: s })}
                  className={`text-left px-4 py-3 rounded border transition-colors ${
                    form.stage === s ? "border-verified bg-verified-soft" : "border-line hover:border-ink-soft"
                  }`}
                >
                  {s.replace("_", " ")}
                </button>
              ))}
            </div>
            <NavButtons onBack={back} onNext={next} />
          </StepCard>
        )}

        {step === 2 && (
          <StepCard title="What sector are you in?">
            <div className="grid grid-cols-2 gap-2">
              {SECTORS.map((s) => (
                <button
                  key={s}
                  onClick={() => setForm({ ...form, sector: s })}
                  className={`px-4 py-3 rounded border text-sm transition-colors ${
                    form.sector === s ? "border-verified bg-verified-soft" : "border-line hover:border-ink-soft"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <NavButtons onBack={back} onNext={next} nextDisabled={!form.sector} />
          </StepCard>
        )}

        {step === 3 && (
          <StepCard title="Where are you based?">
            <div className="grid grid-cols-2 gap-2">
              {COUNTRIES.map((c) => (
                <button
                  key={c}
                  onClick={() => setForm({ ...form, geography: c })}
                  className={`px-4 py-3 rounded border text-sm transition-colors ${
                    form.geography === c ? "border-verified bg-verified-soft" : "border-line hover:border-ink-soft"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
            <NavButtons onBack={back} onNext={next} nextDisabled={!form.geography} />
          </StepCard>
        )}

        {step === 4 && (
          <StepCard title="How much are you raising?">
            <Field label="Amount in USD">
              <input
                type="number"
                autoFocus
                className="input-field"
                value={form.askAmountUsd}
                onChange={(e) => setForm({ ...form, askAmountUsd: e.target.value })}
                placeholder="500000"
              />
            </Field>
            <NavButtons onBack={back} onNext={createCompanyAndAdvance} nextDisabled={!form.askAmountUsd} nextLabel={saving ? "Saving…" : "Next"} nextLoading={saving} />
          </StepCard>
        )}

        {step === 5 && companyId && (
          <StepCard title="Your deck">
            <DeckStep companyId={companyId} generationAvailable={deckGenAvailable} onDone={() => setDeckDone(true)} />
            <NavButtons onBack={back} onNext={next} nextDisabled={!deckDone} nextLabel="Next" />
          </StepCard>
        )}

        {step === 6 && (
          <StepCard title="Connect Gmail">
            <p className="text-sm text-ink-soft mb-6">
              Outreach sends through your own Gmail account — never a shared platform address. You
              can also skip this and connect later from Settings.
            </p>
            <button className="btn-primary w-full mb-3" onClick={connectGmail}>
              Connect Gmail
            </button>
            <button className="btn-secondary w-full" onClick={next}>
              Skip for now
            </button>
          </StepCard>
        )}

        {step === 7 && (
          <StepCard title="You're set up">
            <p className="text-sm text-ink-soft mb-6">
              Your company profile is saved{deckDone ? ", your deck is ready," : ""} and you can find
              matched investors whenever you're ready.
            </p>
            <button className="btn-primary w-full" onClick={finish}>
              Go to dashboard
            </button>
          </StepCard>
        )}
      </div>
    </div>
  );
}

function StepCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-8 animate-fade-up">
      <h1 className="font-display text-2xl mb-6">{title}</h1>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className="label block mb-1.5">{label}</label>
      {children}
    </div>
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
  generationAvailable,
  onDone,
}: {
  companyId: string;
  generationAvailable: boolean | null;
  onDone: () => void;
}) {
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      await api.post(`/api/decks/${companyId}/generate`);
      setDone(true);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const token = localStorage.getItem("gopitch_token");
      const apiBase = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:4000";
      const formData = new FormData();
      formData.append("deck", file);
      const res = await fetch(`${apiBase}/api/decks/${companyId}/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Upload failed.");
      }
      setDone(true);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  if (done) {
    return <p className="text-sm text-verified bg-verified-soft rounded px-3 py-2 mb-4">Deck ready.</p>;
  }

  return (
    <div className="mb-4">
      {generationAvailable && (
        <button className="btn-primary w-full mb-3" onClick={handleGenerate} disabled={generating}>
          {generating ? "Generating…" : "Generate deck with AI"}
        </button>
      )}

      {generationAvailable === false && (
        <p className="text-xs text-signal bg-signal-soft rounded px-3 py-2 mb-3">
          AI generation isn't available right now — upload your own deck instead.
        </p>
      )}

      <label className="btn-secondary w-full text-center cursor-pointer block">
        {uploading ? "Uploading…" : "Upload deck (PPTX or PDF)"}
        <input type="file" accept=".pptx,.pdf" className="hidden" onChange={handleUpload} disabled={uploading} />
      </label>

      {error && <p className="text-sm text-danger mt-3">{error}</p>}
    </div>
  );
}
