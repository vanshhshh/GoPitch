"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";
import { ArrowLeft, ArrowRight, CheckCircle2 } from "lucide-react";
import { api, errorMessage, getToken, StoredUser } from "@/lib/api";
import { FormField, ProgressBar, ProgressIndicator } from "@/components/ui";
import {
  DocumentsEditor,
  FlushRef,
  FoundersEditor,
  FundraisingEditor,
  OverviewEditor,
  PreferencesEditor,
  ProductMarketEditor,
  TractionEditor,
} from "@/components/profile/Sections";
import { IntelligenceReview } from "@/components/profile/IntelligenceReview";
import { Profile } from "@/components/profile/types";

const STEPS = ["Founders", "Company", "Product & market", "Traction", "Fundraising", "Investor preferences", "Documents & review"];
// Which onboarding step each completeness section lives on (for "fix this" links).
const STEP_OF: Record<string, number> = { founders: 0, overview: 1, productMarket: 2, traction: 3, fundraising: 4, preferences: 5, documents: 6 };

export default function OnboardingPage() {
  return (
    <Suspense fallback={<FullPageNote text="Loading…" />}>
      <Onboarding />
    </Suspense>
  );
}

function FullPageNote({ text }: { text: string }) {
  return <div className="min-h-screen flex items-center justify-center text-sm text-ink-soft">{text}</div>;
}

function Onboarding() {
  const router = useRouter();
  const params = useSearchParams();
  const startNew = params.get("new") === "1";
  const [profile, setProfile] = useState<Profile | null>(null);
  const [needsName, setNeedsName] = useState(false);
  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(0);
  const [moving, setMoving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const flushRef: FlushRef = useRef(null);

  // Resume from the server: progress survives logout, a new device, and the Google round-trip.
  useEffect(() => {
    if (!getToken()) {
      router.replace("/login?next=/onboarding");
      return;
    }
    (async () => {
      try {
        const me = await api.get<StoredUser>("/api/auth/me");
        if (me.role === "ADMIN") return router.replace("/admin");
        const companies = await api.get<{ id: string; onboardingComplete: boolean }[]>("/api/company-profile/companies");
        const draft = companies.find((c) => !c.onboardingComplete);
        if (!draft) {
          if (me.hasCompany && !startNew) return router.replace("/dashboard");
          return setNeedsName(true);
        }
        const p = await api.get<Profile>(`/api/company-profile?companyId=${draft.id}`);
        load(p);
      } catch (err) {
        toast.error(errorMessage(err, "Couldn't load your profile."));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function load(p: Profile) {
    setNeedsName(false);
    setProfile(p);
    const s = Math.min(p.onboarding.step, STEPS.length - 1);
    setStep(s);
    setMaxStep(s);
    setConfirmed(p.intelligence?.status === "CONFIRMED");
  }

  const onSaved = useCallback((p: Profile) => {
    setProfile(p);
    if (p.intelligence?.status !== "CONFIRMED") setConfirmed(false);
  }, []);

  async function go(to: number) {
    if (!profile || moving) return;
    setMoving(true);
    try {
      const ok = (await flushRef.current?.()) ?? true;
      if (!ok) return toast.error("Fix the highlighted field before continuing.");
      if (to > step) await api.post(`/api/company-profile/${profile.id}/onboarding/step`, { step: to });
      flushRef.current = null;
      setStep(to);
      setMaxStep((m) => Math.max(m, to));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't save your progress."));
    } finally {
      setMoving(false);
    }
  }

  async function saveAndExit() {
    await flushRef.current?.();
    toast.success("Progress saved. Pick up where you left off any time.");
    router.push("/dashboard");
  }

  async function complete() {
    if (!profile) return;
    setCompleting(true);
    try {
      await flushRef.current?.();
      await api.post(`/api/company-profile/${profile.id}/onboarding/complete`);
      toast.success("Your company profile is ready.");
      router.replace("/dashboard/investors");
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't finish onboarding."));
      const fresh = await api.get<Profile>(`/api/company-profile?companyId=${profile.id}`).catch(() => null);
      if (fresh) setProfile(fresh);
    } finally {
      setCompleting(false);
    }
  }

  if (needsName) return <StartCard additional={startNew} onCreated={load} />;
  if (!profile) return <FullPageNote text="Loading your profile…" />;

  const editorProps = { profile, onSaved, flushRef };
  const missing = profile.completeness.missingRequired;

  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-20 bg-surface/95 backdrop-blur border-b border-line">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3">
          <div className="flex items-center justify-between gap-3 mb-3">
            <Link href="/dashboard" className="font-display text-lg text-navy">
              GoPitch
            </Link>
            <div className="flex items-center gap-3">
              <span className="text-xs text-ink-soft hidden sm:inline">Profile {profile.completeness.percent}% complete</span>
              <button className="btn-ghost text-xs" onClick={saveAndExit}>
                Save &amp; finish later
              </button>
            </div>
          </div>
          <ProgressIndicator steps={STEPS} current={step} onSelect={(i) => i <= maxStep && i !== step && go(i)} />
          <div className="sm:hidden mt-2 flex items-center justify-between text-xs text-ink-soft">
            <span>
              Step {step + 1} of {STEPS.length} · {STEPS[step]}
            </span>
            <span>{profile.completeness.percent}%</span>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <div className="card p-5 sm:p-8 animate-fade-up" key={step}>
          {step === 0 && <FoundersEditor {...editorProps} />}
          {step === 1 && <OverviewEditor {...editorProps} />}
          {step === 2 && <ProductMarketEditor {...editorProps} />}
          {step === 3 && <TractionEditor {...editorProps} />}
          {step === 4 && <FundraisingEditor {...editorProps} />}
          {step === 5 && <PreferencesEditor {...editorProps} />}
          {step === 6 && (
            <div className="space-y-10">
              <DocumentsEditor {...editorProps} />
              <div>
                <h2 className="font-display text-xl mb-1">Review your profile</h2>
                <p className="text-sm text-ink-soft mb-5">Check the summary we built from your answers. Correct anything that's off, then confirm.</p>
                {missing.length > 0 && (
                  <div className="card p-4 mb-5 border-signal/30 bg-signal-soft/40">
                    <p className="text-sm font-medium text-signal mb-2">Still needed before you can finish</p>
                    <ul className="space-y-1">
                      {missing.map((m) => (
                        <li key={m.field}>
                          <button className="text-sm text-ink hover:text-verified underline-offset-2 hover:underline" onClick={() => go(STEP_OF[m.section] ?? 0)}>
                            {m.label} →
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <IntelligenceReview profile={profile} onConfirmed={() => setConfirmed(true)} compact />
              </div>
              <div className="border-t border-line pt-6">
                <ProgressBar value={profile.completeness.percent} label="Profile completeness" />
                <p className="text-xs text-ink-soft mt-2">{profile.completeness.percent}% complete — optional answers can be added later from My Company.</p>
                <button className="btn-primary mt-4 w-full sm:w-auto inline-flex items-center justify-center gap-2" onClick={complete} disabled={completing || !profile.completeness.canComplete || !confirmed}>
                  <CheckCircle2 size={16} aria-hidden />
                  {completing ? "Finishing…" : "Finish and see my investor matches"}
                </button>
                {(!profile.completeness.canComplete || !confirmed) && (
                  <p className="text-xs text-ink-soft mt-2">
                    {!profile.completeness.canComplete ? "Complete the required items above." : "Confirm your profile summary to finish."}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <nav className="flex items-center justify-between mt-6" aria-label="Onboarding steps">
          <button className="btn-secondary inline-flex items-center gap-1.5" onClick={() => go(step - 1)} disabled={step === 0 || moving}>
            <ArrowLeft size={14} aria-hidden /> Back
          </button>
          {step < STEPS.length - 1 && (
            <button className="btn-primary inline-flex items-center gap-1.5" onClick={() => go(step + 1)} disabled={moving}>
              {moving ? "Saving…" : "Next"} <ArrowRight size={14} aria-hidden />
            </button>
          )}
        </nav>
      </main>
    </div>
  );
}

function StartCard({ additional, onCreated }: { additional: boolean; onCreated: (p: Profile) => void }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  async function start(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      onCreated(await api.post<Profile>("/api/company-profile", { name, additional }));
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't start your profile."));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={start} className="card p-6 sm:p-8 w-full max-w-md animate-fade-up">
        <p className="label mb-2">{additional ? "New company" : "Welcome to GoPitch"}</p>
        <h1 className="font-display text-2xl mb-2">Let's build your fundraising profile</h1>
        <p className="text-sm text-ink-soft mb-6">
          Seven short steps — about 10 minutes. Everything saves as you go, and the more specific you are, the more relevant your investor matches.
        </p>
        <FormField label="Company name">{(p) => <input className="input-field" {...p} required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} autoFocus />}</FormField>
        <button className="btn-primary w-full mt-5" disabled={saving || !name.trim()}>
          {saving ? "Starting…" : "Start"}
        </button>
      </form>
    </div>
  );
}
