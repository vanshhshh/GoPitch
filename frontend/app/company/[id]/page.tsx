"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";
import { api, ApiError, downloadDeck, errorMessage, getToken } from "@/lib/api";
import { MatchStamp } from "@/components/MatchStamp";
import { Pagination } from "@/components/Pagination";
import { UpgradePrompt } from "@/components/UpgradePrompt";

interface Company {
  id: string;
  name: string;
  oneLiner: string;
  problem: string;
  solution: string;
  stage: string;
  sector: string[];
  geography: string[];
  askAmountUsd: number;
  extractedKeywords: string[];
}

interface Deck {
  id: string;
  version: number;
  source: "generated" | "uploaded";
  sections: Record<string, any> | null;
  uploadedFileName?: string | null;
  uploadedFileType?: string | null;
  createdAt: string;
}

interface Draft {
  id: string;
  investorId: string;
  investorName?: string;
  investorFirm?: string;
  subject: string;
  bodyText: string;
  matchScore: number;
  matchReasons: string[];
  status: string;
}

interface MatchItem {
  id: string;
  name: string;
  firm: string;
  score: number;
  reasons: string[];
  alreadyContacted: boolean;
}

interface MatchPreview {
  totalMatches: number;
  totalFundsMatched: number;
  alreadyContactedCount: number;
  nextCampaignSize: number;
  matchableInvestorCount: number;
  entitlement: { tier: string; investorLimit: number; remainingToAllocate: number };
  investors: MatchItem[];
}

const STAGES = ["IDEA", "PRE_SEED", "SEED", "SERIES_A", "SERIES_B_PLUS"];
const stageLabel = (s: string) => s.replace(/_/g, " ");

export default function CompanyPage() {
  return (
    <Suspense fallback={<Shell>Loading…</Shell>}>
      <CompanyContent />
    </Suspense>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 text-ink-soft text-sm">{children}</main>;
}

function CompanyContent() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const companyId = params.id as string;
  const showAll = searchParams.get("view") === "all-matches";

  const [company, setCompany] = useState<Company | null>(null);
  const [companyError, setCompanyError] = useState<string | null>(null);
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [deckStatus, setDeckStatus] = useState<{ generationAvailable: boolean; planAllowsGeneration: boolean } | null>(null);
  const [preview, setPreview] = useState<MatchPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [creatingCampaign, setCreatingCampaign] = useState(false);
  const [campaignError, setCampaignError] = useState<string | null>(null);
  const [result, setResult] = useState<{ drafts: Draft[]; totalMatches: number; selectedCount: number; tierName: string; campaignId: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [upgradeTier, setUpgradeTier] = useState<string | null>(null);

  const refreshDecks = useCallback(() => {
    api.get<Deck[]>(`/api/decks/${companyId}`).then(setDecks).catch(() => setDecks([]));
  }, [companyId]);

  const refreshPreview = useCallback(() => {
    api
      .get<MatchPreview>(`/api/campaigns/preview/${companyId}`)
      .then((p) => {
        setPreview(p);
        setPreviewError(null);
      })
      .catch((err) => setPreviewError(errorMessage(err, "Couldn't load investor matches.")));
  }, [companyId]);

  useEffect(() => {
    if (!getToken()) {
      router.replace(`/login?next=/company/${companyId}`);
      return;
    }
    api
      .get<Company>(`/api/companies/${companyId}`)
      .then((c) => {
        setCompany(c);
        refreshDecks();
        refreshPreview();
      })
      .catch((err) => setCompanyError(err instanceof ApiError ? err.message : "Company not found."));
    api.get<{ generationAvailable: boolean; planAllowsGeneration: boolean }>("/api/decks/config/status").then(setDeckStatus).catch(() => {});
  }, [companyId, router, refreshDecks, refreshPreview]);

  async function handleLaunchCampaign() {
    if (creatingCampaign) return;
    setCreatingCampaign(true);
    setCampaignError(null);
    try {
      // No tier is sent: the server uses the founder's actual plan.
      const res = await api.post<{
        campaign: { id: string };
        drafts: Draft[];
        totalMatches: number;
        selectedCount: number;
        tierInfo: { name: string };
      }>("/api/campaigns", { companyId });
      setResult({
        drafts: [...res.drafts].sort((a, b) => b.matchScore - a.matchScore),
        totalMatches: res.totalMatches,
        selectedCount: res.selectedCount,
        tierName: res.tierInfo.name,
        campaignId: res.campaign.id,
      });
      toast.success(`${res.selectedCount} personalized emails drafted. Review them, then send from Campaigns.`);
      refreshPreview();
    } catch (err) {
      setCampaignError(errorMessage(err, "Couldn't create the campaign."));
      if (err instanceof ApiError && err.body?.upgradeRequired) setUpgradeTier(err.body.entitlementTier ?? "FREE");
    } finally {
      setCreatingCampaign(false);
    }
  }

  if (companyError) {
    return (
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <Link href="/dashboard" className="text-sm text-ink-soft hover:text-ink transition-colors">
          ← Dashboard
        </Link>
        <div className="card p-8 mt-6">
          <h1 className="font-display text-2xl mb-2">Company unavailable</h1>
          <p className="text-sm text-ink-soft mb-6">{companyError} It may belong to a different account, or it may no longer exist.</p>
          <Link href="/dashboard" className="btn-primary inline-block">
            Go to dashboard
          </Link>
        </div>
      </main>
    );
  }

  if (!company) return <Shell>Loading…</Shell>;

  const latestDeck = decks?.[0];
  const hasDeck = !!latestDeck;

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 space-y-8">
      <Link href="/dashboard" className="text-sm text-ink-soft hover:text-ink transition-colors">
        ← Dashboard
      </Link>

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-3xl break-words">{company.name}</h1>
          <p className="text-ink-soft mt-1">{company.oneLiner}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs">
            <span className="label">{stageLabel(company.stage)}</span>
            <span className="font-mono text-ink-soft">${company.askAmountUsd.toLocaleString()} ask</span>
            <span className="text-ink-soft">{company.sector.join(", ")}</span>
            <span className="text-ink-soft">{company.geography.join(", ")}</span>
          </div>
        </div>
        <button className="btn-secondary text-sm shrink-0" onClick={() => setEditing((e) => !e)}>
          {editing ? "Close editor" : "Edit profile"}
        </button>
      </div>

      {editing && (
        <CompanyEditor
          company={company}
          onSaved={(c) => {
            setCompany(c);
            setEditing(false);
            refreshPreview();
          }}
        />
      )}

      <DeckSection companyId={companyId} decks={decks} status={deckStatus} onChanged={() => {
        refreshDecks();
        api.get<Company>(`/api/companies/${companyId}`).then(setCompany).catch(() => {});
        refreshPreview();
      }} />

      <section className="card p-6 animate-fade-up">
        <div className="flex items-center justify-between mb-4 gap-3">
          <h2 className="font-display text-lg">Investor matches</h2>
          {showAll && (
            <Link href={`/company/${companyId}`} className="text-sm text-ink-soft hover:text-ink">
              ← Back to overview
            </Link>
          )}
        </div>

        {previewError && <Notice tone="danger">{previewError}</Notice>}

        {showAll ? (
          <AllMatches companyId={companyId} />
        ) : !preview ? (
          !previewError && <p className="text-sm text-ink-soft">Scoring investors…</p>
        ) : (
          <MatchOverview
            preview={preview}
            companyId={companyId}
            hasDeck={hasDeck}
            creating={creatingCampaign}
            onLaunch={handleLaunchCampaign}
            campaignCreated={!!result}
          />
        )}

        {campaignError && <Notice tone="danger">{campaignError}</Notice>}

        {result && !showAll && (
          <div className="mt-6 pt-6 border-t border-line-soft">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
              <p className="text-sm">
                <span className="font-medium">{result.selectedCount} emails drafted</span>
                <span className="text-ink-soft">
                  {" "}
                  · {result.totalMatches.toLocaleString()} investors matched; {result.selectedCount} selected for this campaign by best fit and your{" "}
                  {result.tierName} plan allowance.
                </span>
              </p>
              <Link href="/dashboard/campaigns" className="btn-primary text-sm text-center shrink-0">
                Review &amp; send
              </Link>
            </div>
            <div className="space-y-3">
              {result.drafts.map((d) => (
                <DraftCard key={d.id} draft={d} />
              ))}
            </div>
          </div>
        )}
      </section>
      <UpgradePrompt open={!!upgradeTier} onClose={() => setUpgradeTier(null)} tier={upgradeTier ?? "FREE"} limit={preview?.entitlement.investorLimit ?? 30} />
    </main>
  );
}

function Notice({ tone, children }: { tone: "danger" | "signal"; children: React.ReactNode }) {
  const cls = tone === "danger" ? "text-danger bg-danger-soft border-danger/20" : "text-signal bg-signal-soft border-signal/20";
  return (
    <p className={`text-sm border rounded px-3 py-2 my-4 ${cls}`} role={tone === "danger" ? "alert" : "status"}>
      {children}
    </p>
  );
}

function MatchOverview({
  preview,
  companyId,
  hasDeck,
  creating,
  onLaunch,
  campaignCreated,
}: {
  preview: MatchPreview;
  companyId: string;
  hasDeck: boolean;
  creating: boolean;
  onLaunch: () => void;
  campaignCreated: boolean;
}) {
  if (preview.totalMatches === 0) {
    return (
      <div className="text-sm text-ink-soft space-y-2">
        <p>No verified investors match this company's stage, sector and geography yet.</p>
        <p className="text-xs">
          {preview.matchableInvestorCount.toLocaleString()} verified investors are in the database. Try adding related sector tags with “Edit profile”.
          Matches only include investors with real stage and sector fit — we don't pad the list.
        </p>
      </div>
    );
  }

  const canLaunch = hasDeck && preview.nextCampaignSize > 0 && !campaignCreated;
  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <Stat label="Matched investors" value={preview.totalMatches} />
        <Stat label="Unique funds" value={preview.totalFundsMatched} />
        <Stat label="Already contacted" value={preview.alreadyContactedCount} />
        <Stat label="Next campaign" value={preview.nextCampaignSize} hint={`Plan allowance left: ${preview.entitlement.remainingToAllocate}`} />
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
        <p className="text-xs text-ink-soft">
          Top {preview.investors.length} of {preview.totalMatches.toLocaleString()} matches
        </p>
        <div className="flex gap-2">
          <Link href={`/company/${companyId}?view=all-matches`} className="btn-secondary text-sm">
            View all matches
          </Link>
          <button className="btn-primary text-sm" onClick={onLaunch} disabled={!canLaunch || creating}>
            {creating ? `Drafting ${preview.nextCampaignSize} emails…` : `Start campaign (${preview.nextCampaignSize})`}
          </button>
        </div>
      </div>
      {!hasDeck && <Notice tone="signal">Add a deck (upload or generate) before starting a campaign.</Notice>}
      {hasDeck && preview.nextCampaignSize === 0 && (
        <Notice tone="signal">
          {preview.entitlement.remainingToAllocate === 0
            ? "Your plan's email allowance is fully used or already drafted. "
            : "You've already contacted every matched investor. "}
          <Link href="/dashboard/billing" className="underline">
            See plans
          </Link>
        </Notice>
      )}
      <div className="grid gap-2">
        {preview.investors.map((investor) => (
          <MatchRow key={investor.id} investor={investor} />
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="border border-line-soft rounded p-3" title={hint}>
      <p className="font-display text-2xl">{value.toLocaleString()}</p>
      <p className="text-[11px] text-ink-soft">{label}</p>
    </div>
  );
}

function MatchRow({ investor }: { investor: MatchItem }) {
  return (
    <div className="border border-line-soft rounded p-3 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {investor.name}
          {investor.alreadyContacted && <span className="ml-2 text-[10px] uppercase tracking-wide text-ink-soft bg-line-soft px-1.5 py-0.5 rounded">Contacted</span>}
        </p>
        <p className="text-xs text-ink-soft">{investor.firm}</p>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {investor.reasons.slice(0, 3).map((reason, i) => (
            <span key={i} className="text-[11px] bg-verified-soft text-verified px-2 py-0.5 rounded">
              {reason}
            </span>
          ))}
        </div>
      </div>
      <div className="shrink-0">
        <MatchStamp score={investor.score} size={32} />
      </div>
    </div>
  );
}

function AllMatches({ companyId }: { companyId: string }) {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [hideContacted, setHideContacted] = useState(false);
  const [data, setData] = useState<{ items: MatchItem[]; total: number; totalMatches: number; totalFundsMatched: number; pageSize: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(q);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ page: String(page), pageSize: "25", hideContacted: String(hideContacted) });
    if (query) params.set("q", query);
    api
      .get<typeof data>(`/api/campaigns/matches/${companyId}?${params}`)
      .then((d) => !cancelled && (setData(d), setError(null)))
      .catch((err) => !cancelled && setError(errorMessage(err, "Couldn't load matches.")));
    return () => {
      cancelled = true;
    };
  }, [companyId, page, query, hideContacted]);

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <input className="input-field sm:max-w-xs" placeholder="Search investor or fund" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search matches" />
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input type="checkbox" checked={hideContacted} onChange={(e) => (setHideContacted(e.target.checked), setPage(1))} />
          Hide already contacted
        </label>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      {!data ? (
        <p className="text-sm text-ink-soft">Loading…</p>
      ) : (
        <>
          <p className="text-xs text-ink-soft mb-3">
            {data.totalMatches.toLocaleString()} matched investors across {data.totalFundsMatched.toLocaleString()} funds
            {data.total !== data.totalMatches && ` · ${data.total.toLocaleString()} shown with these filters`}
          </p>
          {data.items.length === 0 ? (
            <p className="text-sm text-ink-soft">No matches for these filters.</p>
          ) : (
            <div className="grid gap-2">
              {data.items.map((i) => (
                <MatchRow key={i.id} investor={i} />
              ))}
            </div>
          )}
          <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      )}
    </div>
  );
}

function DraftCard({ draft }: { draft: Draft }) {
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.bodyText);
  const [saved, setSaved] = useState({ subject: draft.subject, body: draft.bodyText });
  const [saving, setSaving] = useState(false);
  const dirty = subject !== saved.subject || body !== saved.body;

  async function save() {
    setSaving(true);
    try {
      const res = await api.patch<{ subject: string; bodyText: string }>(`/api/sends/${draft.id}`, { subject, bodyText: body });
      setSaved({ subject: res.subject, body: res.bodyText });
      setSubject(res.subject);
      toast.success("Draft saved.");
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't save the draft."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <details className="border border-line-soft rounded p-4 animate-fade-up">
      <summary className="flex items-center justify-between gap-3 cursor-pointer list-none">
        <div className="flex items-center gap-3 min-w-0">
          <MatchStamp score={draft.matchScore} size={36} />
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{saved.subject}</p>
            <p className="text-xs text-ink-soft truncate">
              {draft.investorName} · {draft.investorFirm}
            </p>
          </div>
        </div>
        <span className="label shrink-0">{draft.status}</span>
      </summary>
      <div className="mt-4 pt-4 border-t border-line-soft space-y-3">
        <label className="block">
          <span className="label block mb-1">Subject</span>
          <input className="input-field" maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label className="block">
          <span className="label block mb-1">Email</span>
          <textarea className="input-field" rows={7} maxLength={10000} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        <div className="flex flex-wrap gap-1.5">
          {draft.matchReasons.map((r, i) => (
            <span key={i} className="text-[11px] bg-verified-soft text-verified px-2 py-0.5 rounded">
              {r}
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <button className="btn-primary text-sm" onClick={save} disabled={!dirty || saving || !subject.trim() || !body.trim()}>
            {saving ? "Saving…" : "Save draft"}
          </button>
          {dirty && (
            <button className="btn-secondary text-sm" onClick={() => (setSubject(saved.subject), setBody(saved.body))}>
              Discard changes
            </button>
          )}
        </div>
      </div>
    </details>
  );
}

function DeckSection({
  companyId,
  decks,
  status,
  onChanged,
}: {
  companyId: string;
  decks: Deck[] | null;
  status: { generationAvailable: boolean; planAllowsGeneration: boolean } | null;
  onChanged: () => void;
}) {
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestDeck = decks?.[0];

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      await api.post(`/api/decks/${companyId}/generate`);
      toast.success("Deck generated.");
      onChanged();
    } catch (err) {
      setError(errorMessage(err, "Deck generation failed."));
    } finally {
      setGenerating(false);
    }
  }

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) return setError("Deck files must be 25 MB or smaller.");
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("deck", file);
      await api.postForm(`/api/decks/${companyId}/upload`, fd);
      toast.success("Deck uploaded.");
      onChanged();
    } catch (err) {
      setError(errorMessage(err, "Upload failed."));
    } finally {
      setUploading(false);
    }
  }

  async function open(deck: Deck) {
    try {
      await downloadDeck(deck.id, deck.uploadedFileName || `deck.${deck.uploadedFileType || "pdf"}`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't open the deck."));
    }
  }

  return (
    <section className="card p-6 animate-fade-up">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h2 className="font-display text-lg">Deck</h2>
        <div className="flex gap-2">
          <label className={`btn-secondary text-sm cursor-pointer ${uploading ? "opacity-60 pointer-events-none" : ""}`}>
            {uploading ? "Uploading…" : latestDeck ? "Upload new version" : "Upload deck"}
            <input type="file" accept=".pptx,.pdf" className="sr-only" onChange={upload} disabled={uploading} />
          </label>
          {status?.generationAvailable && (
            <button className="btn-primary text-sm" onClick={generate} disabled={generating}>
              {generating ? "Generating…" : latestDeck ? "Regenerate" : "Generate with AI"}
            </button>
          )}
        </div>
      </div>
      {status && !status.planAllowsGeneration && (
        <p className="text-xs text-ink-soft mb-3">
          AI deck generation is included from <Link href="/dashboard/billing" className="text-verified hover:underline">Starter</Link>. On Free, upload your own PPTX or PDF.
        </p>
      )}
      {error && <Notice tone="danger">{error}</Notice>}

      {decks === null ? (
        <p className="text-ink-soft text-sm">Loading…</p>
      ) : !latestDeck ? (
        <p className="text-ink-soft text-sm">No deck yet. Upload your PPTX or PDF{status?.generationAvailable ? ", or generate slide copy from your company profile" : ""}.</p>
      ) : latestDeck.source === "uploaded" ? (
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{latestDeck.uploadedFileName || "Uploaded deck"}</p>
            <p className="text-xs text-ink-soft mt-1">
              Version {latestDeck.version} · {latestDeck.uploadedFileType?.toUpperCase() || "file"}
            </p>
          </div>
          <button className="btn-secondary text-sm shrink-0" onClick={() => open(latestDeck)}>
            Download
          </button>
        </div>
      ) : latestDeck.sections ? (
        <div className="space-y-4">
          {Object.entries(latestDeck.sections)
            .filter(([key]) => key !== "extractedKeywords")
            .map(([key, value]) => (
              <div key={key}>
                <p className="label mb-1">{key.replace(/([A-Z])/g, " $1").replace("Slide", "").trim()}</p>
                <p className="text-sm leading-relaxed whitespace-pre-line">{String(value)}</p>
              </div>
            ))}
        </div>
      ) : (
        <p className="text-ink-soft text-sm">Deck saved, but no generated slide sections are available.</p>
      )}
    </section>
  );
}

function CompanyEditor({ company, onSaved }: { company: Company; onSaved: (c: Company) => void }) {
  const [form, setForm] = useState({
    name: company.name,
    oneLiner: company.oneLiner,
    stage: company.stage,
    sector: company.sector.join(", "),
    geography: company.geography.join(", "),
    askAmountUsd: String(company.askAmountUsd),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const updated = await api.patch<Company>(`/api/companies/${company.id}`, {
        name: form.name,
        oneLiner: form.oneLiner,
        stage: form.stage,
        sector: form.sector.split(",").map((s) => s.trim()).filter(Boolean),
        geography: form.geography.split(",").map((s) => s.trim()).filter(Boolean),
        askAmountUsd: Number(form.askAmountUsd),
      });
      toast.success("Company profile updated — matches refreshed.");
      onSaved(updated);
    } catch (err) {
      setError(errorMessage(err, "Couldn't save."));
    } finally {
      setSaving(false);
    }
  }

  const input = (key: keyof typeof form, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block">
      <span className="label block mb-1.5">{label}</span>
      <input className="input-field" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} required {...props} />
    </label>
  );

  return (
    <form onSubmit={save} className="card p-6 space-y-4 animate-fade-up">
      {input("name", "Company name", { maxLength: 120 })}
      {input("oneLiner", "One-line description", { maxLength: 200 })}
      <label className="block">
        <span className="label block mb-1.5">Stage</span>
        <select className="input-field" value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })}>
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {stageLabel(s)}
            </option>
          ))}
        </select>
      </label>
      {input("sector", "Sector tags (comma-separated)", { placeholder: "fintech, payments" })}
      {input("geography", "Geography (comma-separated)", { placeholder: "India, Singapore" })}
      {input("askAmountUsd", "Raise amount (USD)", { type: "number", min: 1, step: 1 })}
      {error && <Notice tone="danger">{error}</Notice>}
      <button type="submit" className="btn-primary" disabled={saving}>
        {saving ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
