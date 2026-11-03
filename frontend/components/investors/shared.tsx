"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bookmark, BookmarkCheck, Ban, Check, Plus } from "lucide-react";
import toast from "react-hot-toast";
import { api, errorMessage } from "@/lib/api";
import { humanize, investorTypeLabel, money, ScorePill } from "@/components/ui";

export interface Component {
  score: number | null;
  weight: number;
  evidence: string | null;
}
export interface Match {
  id: string;
  name: string;
  title: string | null;
  firm: string;
  fundKey: string;
  investorType: string | null;
  stageFocus: string[];
  sectorFocus: string[];
  geoFocus: string[];
  checkSizeMinUsd: number | null;
  checkSizeMaxUsd: number | null;
  score: number;
  coverage: number;
  reasons: string[];
  mismatches: string[];
  missing: string[];
  components: Record<string, Component>;
  alreadyContacted: boolean;
  saved: boolean;
  fundPreviouslyContacted: boolean;
}

export const COMPONENT_LABELS: Record<string, string> = {
  sector: "Sector",
  stage: "Stage",
  checkSize: "Check size",
  thesis: "Thesis",
  businessModel: "Business model",
  geography: "Geography",
  founderMarketFit: "Founder fit",
  tractionMandate: "Traction / mandate",
};

export const checkRange = (min: number | null, max: number | null) => (min == null && max == null ? "Not disclosed" : `${money(min ?? 0)}–${max != null ? money(max) : "open"}`);

// ---------- Selection (survives navigation between list, fund and person pages) ----------
const SEL_KEY = "gopitch_selected_investors";
export function useSelection() {
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    try {
      setIds(JSON.parse(sessionStorage.getItem(SEL_KEY) ?? "[]"));
    } catch {}
    const sync = () => {
      try {
        setIds(JSON.parse(sessionStorage.getItem(SEL_KEY) ?? "[]"));
      } catch {}
    };
    window.addEventListener("gopitch:selection", sync);
    return () => window.removeEventListener("gopitch:selection", sync);
  }, []);
  const write = useCallback((next: string[]) => {
    sessionStorage.setItem(SEL_KEY, JSON.stringify(next));
    setIds(next);
    window.dispatchEvent(new Event("gopitch:selection"));
  }, []);
  return {
    ids,
    has: (id: string) => ids.includes(id),
    toggle: (id: string) => write(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]),
    clear: () => write([]),
  };
}

export async function setList(companyId: string | null, investorId: string, list: "SAVED" | "EXCLUDED" | null) {
  try {
    await api.put("/api/discovery/lists", { companyId, investorId, list });
    toast.success(list === "SAVED" ? "Saved." : list === "EXCLUDED" ? "Excluded — they won't appear in your matches." : "Removed from your list.");
    return true;
  } catch (err) {
    toast.error(errorMessage(err, "Couldn't update."));
    return false;
  }
}

/** Score breakdown with the evidence behind each criterion. */
export function MatchBreakdown({ match }: { match: Pick<Match, "components" | "coverage" | "mismatches" | "missing" | "score"> }) {
  const entries = Object.entries(match.components).filter(([, c]) => c.weight > 0);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <ScorePill score={match.score} coverage={match.coverage} />
        <p className="text-xs text-ink-soft">
          Score out of 100, based on {Math.round(match.coverage * 100)}% of the criteria. The rest had no data to compare, so they weren't guessed.
        </p>
      </div>
      <ul className="space-y-2">
        {entries.map(([k, c]) => (
          <li key={k} className="text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-navy">
                {COMPONENT_LABELS[k] ?? k} <span className="text-[11px] text-ink-soft">· weight {c.weight}</span>
              </span>
              <span className="font-mono text-xs text-ink-soft">{c.score == null ? "no data" : `${Math.round(c.score * 100)}%`}</span>
            </div>
            <div className="h-1 bg-line-soft rounded-full mt-1 overflow-hidden" aria-hidden>
              <div className={`h-full ${c.score == null ? "" : "bg-verified"}`} style={{ width: `${(c.score ?? 0) * 100}%` }} />
            </div>
            {c.evidence && <p className="text-xs text-ink-soft mt-1">{c.evidence}</p>}
          </li>
        ))}
      </ul>
      {match.mismatches.length > 0 && (
        <div>
          <p className="label mb-1">Potential mismatches</p>
          <ul className="list-disc pl-5 text-sm text-signal space-y-0.5">
            {match.mismatches.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}
      {match.missing.length > 0 && (
        <div>
          <p className="label mb-1">Missing information</p>
          <ul className="list-disc pl-5 text-xs text-ink-soft space-y-0.5">
            {match.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function InvestorCard({
  m,
  selected,
  onToggleSelect,
  onOpen,
  onListChange,
  companyId,
}: {
  m: Match;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onListChange: () => void;
  companyId: string | null;
}) {
  const [busy, setBusy] = useState(false);
  async function list(next: "SAVED" | "EXCLUDED" | null) {
    setBusy(true);
    if (await setList(companyId, m.id, next)) onListChange();
    setBusy(false);
  }
  return (
    <article className={`card p-4 transition-colors ${selected ? "border-verified" : ""}`}>
      <div className="flex items-start gap-3">
        <ScorePill score={m.score} coverage={m.coverage} />
        <div className="flex-1 min-w-0">
          <button onClick={onOpen} className="text-left">
            <h3 className="font-sans text-sm font-medium text-navy hover:underline">{m.name}</h3>
          </button>
          <p className="text-xs text-ink-soft">
            {m.title ? `${m.title} · ` : ""}
            <Link href={`/dashboard/investors/funds/${encodeURIComponent(m.fundKey)}`} className="hover:underline">
              {m.firm.trim()}
            </Link>
            {m.investorType && ` · ${investorTypeLabel(m.investorType)}`}
          </p>
          <p className="text-xs text-ink-soft mt-1">
            {m.stageFocus.map(humanize).join(", ") || "Stage not listed"} · {checkRange(m.checkSizeMinUsd, m.checkSizeMaxUsd)}
          </p>
          {m.reasons.length > 0 && <p className="text-sm text-ink mt-2">{m.reasons.slice(0, 2).join(" · ")}</p>}
          {m.mismatches[0] && <p className="text-xs text-signal mt-1">{m.mismatches[0]}</p>}
          <div className="flex flex-wrap gap-1.5 mt-2">
            {m.alreadyContacted && <span className="chip">Contacted</span>}
            {m.fundPreviouslyContacted && <span className="chip">Fund pitched before</span>}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-line-soft">
        <button
          className={`${selected ? "btn-primary" : "btn-secondary"} text-xs inline-flex items-center gap-1.5`}
          onClick={onToggleSelect}
          disabled={m.alreadyContacted}
          aria-pressed={selected}
          title={m.alreadyContacted ? "Already contacted" : undefined}
        >
          {selected ? <Check size={12} aria-hidden /> : <Plus size={12} aria-hidden />} {selected ? "Selected" : "Add to campaign"}
        </button>
        <button className="btn-ghost text-xs inline-flex items-center gap-1.5" onClick={() => list(m.saved ? null : "SAVED")} disabled={busy} aria-pressed={m.saved}>
          {m.saved ? <BookmarkCheck size={13} aria-hidden /> : <Bookmark size={13} aria-hidden />} {m.saved ? "Saved" : "Save"}
        </button>
        <button className="btn-ghost text-xs inline-flex items-center gap-1.5" onClick={() => list("EXCLUDED")} disabled={busy}>
          <Ban size={13} aria-hidden /> Exclude
        </button>
        <button className="btn-ghost text-xs ml-auto" onClick={onOpen}>
          Why this match?
        </button>
      </div>
    </article>
  );
}

/** Sticky tray: selected investors → new campaign, or add to the open draft. */
export function SelectionTray({ companyId }: { companyId: string | null }) {
  const sel = useSelection();
  const [draft, setDraft] = useState<{ id: string; name: string | null } | null>(null);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    if (!sel.ids.length) return;
    api
      .get<{ id: string; companyId: string; status: string; name: string | null }[]>("/api/campaigns")
      .then((cs) => setDraft(cs.find((c) => c.status === "DRAFT" && c.companyId === companyId) ?? null))
      .catch(() => {});
  }, [sel.ids.length, companyId]);

  async function addToDraft() {
    if (!draft) return;
    setAdding(true);
    try {
      const r = await api.post<{ added: number; rejectedInvestorIds: string[] }>(`/api/campaigns/${draft.id}/drafts`, { investorIds: sel.ids });
      toast.success(`${r.added} added to ${draft.name ?? "your draft"}.`);
      sel.clear();
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't add to the draft."));
    } finally {
      setAdding(false);
    }
  }

  if (!sel.ids.length) return null;
  return (
    <div className="fixed bottom-0 inset-x-0 md:left-60 z-30 border-t border-line bg-surface/95 backdrop-blur">
      <div className="max-w-page mx-auto px-4 sm:px-8 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        <p className="text-sm flex-1">
          <span className="font-medium text-navy">{sel.ids.length}</span> investor{sel.ids.length === 1 ? "" : "s"} selected
          <button className="ml-3 text-xs text-ink-soft hover:text-ink underline" onClick={sel.clear}>
            Clear
          </button>
        </p>
        {draft && (
          <button className="btn-secondary text-sm" onClick={addToDraft} disabled={adding}>
            {adding ? "Adding…" : `Add to draft${draft.name ? `: ${draft.name}` : ""}`}
          </button>
        )}
        <Link href="/dashboard/outreach/new" className="btn-primary text-sm text-center">
          Create campaign
        </Link>
      </div>
    </div>
  );
}
