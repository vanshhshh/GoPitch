"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";

interface Company {
  id: string;
  name: string;
  oneLiner: string;
  stage: string;
  askAmountUsd: number;
  createdAt: string;
}

const STAGES = ["IDEA", "PRE_SEED", "SEED", "SERIES_A", "SERIES_B_PLUS"];

export default function DashboardPage() {
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [showWizard, setShowWizard] = useState(false);

  useEffect(() => {
    api
      .get<Company[]>("/api/companies")
      .then(setCompanies)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.push("/login");
      });
  }, [router]);

  return (
    <div className="min-h-screen">
      <main className="max-w-5xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-display text-2xl">Your raises</h1>
            <p className="text-ink-soft text-sm mt-1">Every company you're actively fundraising for.</p>
          </div>
          {!showWizard && (
            <button className="btn-primary" onClick={() => setShowWizard(true)}>
              + New raise
            </button>
          )}
        </div>

        {showWizard && <CompanyWizard onCreated={() => setShowWizard(false)} onCancel={() => setShowWizard(false)} />}

        {companies === null ? (
          <p className="text-ink-soft text-sm">Loading…</p>
        ) : companies.length === 0 && !showWizard ? (
          <div className="card p-10 text-center animate-fade-up">
            <p className="text-ink-soft text-sm mb-4">No raises yet. Start one to generate a deck and find matched investors.</p>
            <button className="btn-primary" onClick={() => setShowWizard(true)}>
              Start your first raise
            </button>
          </div>
        ) : (
          <div className="grid gap-3">
            {companies.map((c) => (
              <Link
                key={c.id}
                href={`/company/${c.id}`}
                className="card p-5 flex items-center justify-between hover:border-ink-soft transition-colors animate-fade-up"
              >
                <div>
                  <h3 className="font-display text-lg">{c.name}</h3>
                  <p className="text-ink-soft text-sm">{c.oneLiner}</p>
                </div>
                <div className="text-right">
                  <p className="label">{c.stage.replace("_", " ")}</p>
                  <p className="font-mono text-sm">${c.askAmountUsd.toLocaleString()}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function CompanyWizard({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    oneLiner: "",
    problem: "",
    solution: "",
    stage: "SEED",
    sector: "",
    geography: "",
    askAmountUsd: "",
    traction: "",
    founderBackground: "",
  });

  const steps = [
    { key: "name", label: "What's your company called?", placeholder: "Velo Pay", type: "text" },
    { key: "oneLiner", label: "Describe it in one line", placeholder: "Cross-border payments infra for freelancers", type: "text" },
    { key: "problem", label: "What problem are you solving?", placeholder: "Be specific — the sharper this is, the better your deck reads.", type: "textarea" },
    { key: "solution", label: "How do you solve it?", placeholder: "What you've actually built.", type: "textarea" },
    { key: "sector", label: "Sector tags (comma-separated)", placeholder: "fintech, payments, cross-border", type: "text" },
    { key: "geography", label: "Geography (comma-separated)", placeholder: "India, SEA", type: "text" },
    { key: "askAmountUsd", label: "How much are you raising, in USD?", placeholder: "500000", type: "number" },
    { key: "traction", label: "Traction so far (optional)", placeholder: "Pilot users, revenue, waitlist — whatever's real.", type: "textarea" },
    { key: "founderBackground", label: "Your background (optional)", placeholder: "What makes you the right person to build this.", type: "textarea" },
  ] as const;

  const current = steps[step];
  const isLast = step === steps.length - 1;
  const value = form[current.key as keyof typeof form];
  const canProceed = current.key === "traction" || current.key === "founderBackground" || value.trim().length > 0;

  async function handleNext() {
    if (!isLast) {
      setStep((s) => s + 1);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const company = await api.post<{ id: string }>("/api/companies", {
        name: form.name,
        oneLiner: form.oneLiner,
        problem: form.problem,
        solution: form.solution,
        stage: form.stage,
        sector: form.sector.split(",").map((s) => s.trim()).filter(Boolean),
        geography: form.geography.split(",").map((s) => s.trim()).filter(Boolean),
        askAmountUsd: Number(form.askAmountUsd),
        traction: form.traction || undefined,
        founderBackground: form.founderBackground || undefined,
      });
      onCreated();
      router.push(`/company/${company.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card p-8 mb-8 animate-fade-up">
      <div className="flex gap-1 mb-6">
        {steps.map((_, i) => (
          <div key={i} className={`h-0.5 flex-1 rounded-full ${i <= step ? "bg-verified" : "bg-line"}`} />
        ))}
      </div>

      {current.key === "name" && step === 0 && (
        <div className="mb-4">
          <label className="label block mb-1.5">Stage</label>
          <select
            className="input-field w-auto"
            value={form.stage}
            onChange={(e) => setForm({ ...form, stage: e.target.value })}
          >
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
        </div>
      )}

      <label className="label block mb-2">{current.label}</label>
      {current.type === "textarea" ? (
        <textarea
          autoFocus
          rows={4}
          className="input-field"
          placeholder={current.placeholder}
          value={value}
          onChange={(e) => setForm({ ...form, [current.key]: e.target.value })}
        />
      ) : (
        <input
          autoFocus
          type={current.type}
          className="input-field"
          placeholder={current.placeholder}
          value={value}
          onChange={(e) => setForm({ ...form, [current.key]: e.target.value })}
        />
      )}

      {error && <p className="text-sm text-danger mt-3">{error}</p>}

      <div className="flex items-center justify-between mt-6">
        <div className="flex gap-2">
          {step > 0 && (
            <button className="btn-secondary" onClick={() => setStep((s) => s - 1)}>
              Back
            </button>
          )}
          <button className="text-sm text-ink-soft hover:text-ink transition-colors" onClick={onCancel}>
            Cancel
          </button>
        </div>
        <button className="btn-primary" onClick={handleNext} disabled={!canProceed || saving}>
          {saving ? "Saving…" : isLast ? "Create raise" : "Next"}
        </button>
      </div>
    </div>
  );
}
