"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, Pencil, RefreshCw, Sparkles } from "lucide-react";
import toast from "react-hot-toast";
import { api, errorMessage } from "@/lib/api";
import { Spinner, StatusBadge } from "@/components/ui";
import { BASIS_LABELS, INTEL_LABELS, Intelligence, Profile } from "./types";

/**
 * Shows the structured company & founder summary with provenance on every field, lets
 * the founder correct anything, and records their confirmation.
 */
export function IntelligenceReview({ profile, onConfirmed, compact }: { profile: Profile; onConfirmed?: (i: Intelligence) => void; compact?: boolean }) {
  const [intel, setIntel] = useState<Intelligence | null | undefined>(undefined);
  const [busy, setBusy] = useState<"generate" | "confirm" | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    api
      .get<Intelligence | Record<string, never>>(`/api/company-profile/${profile.id}/intelligence`)
      .then((i) => setIntel(i && "status" in i ? (i as Intelligence) : null))
      .catch(() => setIntel(null));
  }, [profile.id]);

  async function generate() {
    setBusy("generate");
    try {
      setIntel(await api.post<Intelligence>(`/api/company-profile/${profile.id}/intelligence/generate`));
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't build the summary."));
    } finally {
      setBusy(null);
    }
  }

  async function saveField(key: string, value: string | null) {
    try {
      setIntel(await api.patch<Intelligence>(`/api/company-profile/${profile.id}/intelligence`, { fields: { [key]: value } }));
      setEditing(null);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't save."));
    }
  }

  async function confirm() {
    setBusy("confirm");
    try {
      const i = await api.post<Intelligence>(`/api/company-profile/${profile.id}/intelligence/confirm`);
      setIntel(i);
      onConfirmed?.(i);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't confirm."));
    } finally {
      setBusy(null);
    }
  }

  if (intel === undefined) return <Spinner label="Loading summary…" />;

  if (intel === null) {
    return (
      <div className="card p-6 text-center">
        <Sparkles className="mx-auto text-teal mb-2" size={20} aria-hidden />
        <p className="font-display text-lg">Build your company profile summary</p>
        <p className="text-sm text-ink-soft mt-1 max-w-md mx-auto">
          We'll organise your answers into the profile investors and our matching engine use, flag gaps and inconsistencies, and you'll review it before
          anything is final.
        </p>
        <button className="btn-primary mt-4" onClick={generate} disabled={!!busy}>
          {busy === "generate" ? "Building… (up to a minute)" : "Build summary"}
        </button>
      </div>
    );
  }

  const fields = Object.entries(intel.profile.fields).filter(([k]) => INTEL_LABELS[k]);
  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <StatusBadge status={intel.status} label={intel.status === "CONFIRMED" ? "Confirmed by you" : "Needs your review"} />
          {!intel.profile.aiUsed && <span className="text-xs text-ink-soft">Built from your answers only</span>}
        </div>
        <button className="btn-ghost text-xs inline-flex items-center gap-1.5" onClick={generate} disabled={!!busy}>
          <RefreshCw size={12} aria-hidden /> {busy === "generate" ? "Rebuilding…" : "Rebuild from latest answers"}
        </button>
      </div>
      {intel.profile.aiNote && <p className="text-xs text-ink-soft">{intel.profile.aiNote}</p>}

      {intel.profile.inconsistencies.length > 0 && (
        <div className="card p-4 border-signal/30 bg-signal-soft/40">
          <p className="text-sm font-medium text-signal flex items-center gap-1.5">
            <AlertTriangle size={14} aria-hidden /> Worth double-checking
          </p>
          <ul className="list-disc pl-5 mt-1 text-sm text-ink space-y-0.5">
            {intel.profile.inconsistencies.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="card divide-y divide-line-soft">
        {fields.map(([key, f]) => (
          <div key={key} className="p-4">
            <div className="flex items-center justify-between gap-3 mb-1">
              <p className="label">{INTEL_LABELS[key]}</p>
              <span className={`text-[10px] px-2 py-0.5 rounded ${BASIS_LABELS[f.basis].cls}`}>{BASIS_LABELS[f.basis].text}</span>
            </div>
            {editing === key ? (
              <div className="space-y-2">
                <textarea className="input-field" rows={3} maxLength={1000} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={`Edit ${INTEL_LABELS[key]}`} autoFocus />
                <div className="flex gap-2">
                  <button className="btn-primary text-xs" onClick={() => saveField(key, draft)} disabled={!draft.trim()}>
                    Save
                  </button>
                  <button className="btn-ghost text-xs" onClick={() => saveField(key, null)}>
                    Remove field
                  </button>
                  <button className="btn-ghost text-xs" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm text-ink">{f.value}</p>
                <button
                  className="btn-ghost p-1.5 shrink-0"
                  aria-label={`Edit ${INTEL_LABELS[key]}`}
                  onClick={() => {
                    setEditing(key);
                    setDraft(f.value);
                  }}
                >
                  <Pencil size={13} />
                </button>
              </div>
            )}
            {f.warning && <p className="text-xs text-signal mt-1">{f.warning}</p>}
          </div>
        ))}
        {intel.profile.thesisCategories.length > 0 && (
          <div className="p-4">
            <p className="label mb-2">Investment thesis categories</p>
            <div className="flex flex-wrap gap-1.5">
              {intel.profile.thesisCategories.map((t) => (
                <span key={t.value} className="chip bg-teal-soft border-teal/20 text-teal">
                  {t.value}
                </span>
              ))}
            </div>
            <p className="text-[11px] text-ink-soft mt-2">Used to match you with funds whose thesis mentions the same themes.</p>
          </div>
        )}
      </div>

      {intel.profile.missingInformation.length > 0 && !compact && (
        <div className="card p-4">
          <p className="text-sm font-medium text-navy mb-1">Missing information</p>
          <p className="text-xs text-ink-soft mb-2">Adding these improves matching and what investors see.</p>
          <ul className="flex flex-wrap gap-1.5">
            {intel.profile.missingInformation.map((m) => (
              <li key={m} className="chip">
                {m}
              </li>
            ))}
          </ul>
          <Link href="/dashboard/company" className="text-xs text-verified hover:underline inline-block mt-2">
            Update profile
          </Link>
        </div>
      )}

      {intel.status !== "CONFIRMED" && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <button className="btn-primary inline-flex items-center justify-center gap-1.5" onClick={confirm} disabled={!!busy}>
            <Check size={14} aria-hidden /> {busy === "confirm" ? "Confirming…" : "This is accurate — confirm"}
          </button>
          <p className="text-xs text-ink-soft">Nothing here is shared with investors. It powers your matching and drafts.</p>
        </div>
      )}
    </div>
  );
}
