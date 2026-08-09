"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { MatchStamp } from "@/components/MatchStamp";

interface Company {
  id: string;
  name: string;
  oneLiner: string;
  stage: string;
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
  subject: string;
  bodyText: string;
  matchScore: number;
  matchReasons: string[];
  status: string;
}

interface MatchPreview {
  total: number;
  qualifiedTotal: number;
  mode: "verified" | "imported";
  investors: {
    id: string;
    name: string;
    firm: string;
    score: number | null;
    reasons: string[];
  }[];
}

export default function CompanyPage() {
  const params = useParams();
  const companyId = params.id as string;

  const [company, setCompany] = useState<Company | null>(null);
  const [companyError, setCompanyError] = useState<string | null>(null);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [generating, setGenerating] = useState(false);
  const [genNotice, setGenNotice] = useState<string | null>(null);
  const [creatingCampaign, setCreatingCampaign] = useState(false);
  const [campaignError, setCampaignError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [tierInfo, setTierInfo] = useState<any>(null);
  const [preview, setPreview] = useState<MatchPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [userTier, setUserTier] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCompany(null);
    setCompanyError(null);
    setDecks([]);
    setPreview(null);
    setPreviewError(null);

    api
      .get<Company>(`/api/companies/${companyId}`)
      .then((c) => {
        if (cancelled) return;
        setCompany(c);
        refreshDecks();
        refreshPreview();
      })
      .catch((err) => {
        if (cancelled) return;
        setCompanyError(err instanceof ApiError ? err.message : "Company not found.");
      });

    api.get<{ tier: string | null }>(`/api/billing/subscription`).then((sub) => {
      if (cancelled) return;
      setUserTier(sub.tier || "STARTER");
    }).catch(() => {
      if (cancelled) return;
      setUserTier("STARTER");
    });

    return () => {
      cancelled = true;
    };
  }, [companyId]);

  function refreshDecks() {
    api
      .get<Deck[]>(`/api/decks/${companyId}`)
      .then(setDecks)
      .catch(() => setDecks([]));
  }

  function refreshPreview() {
    api
      .get<MatchPreview>(`/api/campaigns/preview/${companyId}`)
      .then((p) => {
        setPreview(p);
        setPreviewError(null);
      })
      .catch((err) => setPreviewError(err instanceof ApiError ? err.message : "Couldn't preview investors."));
  }

  async function handleGenerateDeck() {
    setGenerating(true);
    setGenNotice(null);
    try {
      const res = await api.post<{ deck: Deck; mocked: boolean; notice?: string }>(
        `/api/decks/${companyId}/generate`
      );
      if (res.notice) setGenNotice(res.notice);
      refreshDecks();
      api.get<Company>(`/api/companies/${companyId}`).then(setCompany); // refresh extractedKeywords
    } finally {
      setGenerating(false);
    }
  }

  async function handleLaunchCampaign() {
    setCreatingCampaign(true);
    setCampaignError(null);
    try {
      const res = await api.post<{ drafts: Draft[]; tierInfo: any }>("/api/campaigns", {
        companyId,
        tier: userTier || "STARTER",
      });
      setDrafts(res.drafts.sort((a, b) => b.matchScore - a.matchScore));
      setTierInfo(res.tierInfo);
      refreshPreview();
    } catch (err) {
      setCampaignError(err instanceof ApiError ? err.message : "Couldn't create campaign.");
    } finally {
      setCreatingCampaign(false);
    }
  }

  if (companyError) {
    return (
      <div className="min-h-screen">
        <main className="max-w-3xl mx-auto px-6 py-10">
          <Link href="/dashboard" className="text-sm text-ink-soft hover:text-ink transition-colors">
            Back to dashboard
          </Link>
          <div className="card p-8 mt-6">
            <h1 className="font-display text-2xl mb-2">Company unavailable</h1>
            <p className="text-sm text-ink-soft mb-6">
              {companyError} The company may belong to a different account, or it may no longer exist.
            </p>
            <Link href="/dashboard" className="btn-primary inline-block">
              Go to dashboard
            </Link>
          </div>
        </main>
      </div>
    );
  }

  if (!company) {
    return (
      <div className="min-h-screen">
        <main className="max-w-3xl mx-auto px-6 py-10 text-ink-soft text-sm">Loading…</main>
      </div>
    );
  }

  const latestDeck = decks[0];
  const hasDeck = !!latestDeck;

  return (
    <div className="min-h-screen">
      <main className="max-w-3xl mx-auto px-6 py-10 space-y-8">
        <Link href="/dashboard" className="text-sm text-ink-soft hover:text-ink transition-colors">
          ← Dashboard
        </Link>
        <div>
          <h1 className="font-display text-3xl">{company.name}</h1>
          <p className="text-ink-soft mt-1">{company.oneLiner}</p>
          <div className="flex gap-4 mt-3 text-xs">
            <span className="label">{company.stage.replace("_", " ")}</span>
            <span className="font-mono text-ink-soft">${company.askAmountUsd.toLocaleString()} ask</span>
          </div>
        </div>

        {/* --- Deck section --- */}
        <section className="card p-6 animate-fade-up">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-lg">Deck</h2>
            <button className="btn-primary" onClick={handleGenerateDeck} disabled={generating}>
              {generating ? "Generating…" : hasDeck ? "Regenerate" : "Generate deck"}
            </button>
          </div>

          {genNotice && (
            <p className="text-xs text-signal bg-signal-soft border border-signal/20 rounded px-3 py-2 mb-4">
              {genNotice}
            </p>
          )}

          {!hasDeck ? (
            <p className="text-ink-soft text-sm">
              No deck yet. Generating pulls together your problem, solution, and traction into structured slide copy.
            </p>
          ) : latestDeck.source === "uploaded" ? (
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">{latestDeck.uploadedFileName || "Uploaded deck"}</p>
                <p className="text-xs text-ink-soft mt-1">
                  Version {latestDeck.version} · {latestDeck.uploadedFileType?.toUpperCase() || "file"}
                </p>
              </div>
              <a
                className="btn-secondary text-sm"
                href={`${process.env.NEXT_PUBLIC_API_BASE || "http://localhost:4000"}/api/decks/file/${latestDeck.id}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open deck
              </a>
            </div>
          ) : latestDeck.sections ? (
            <div className="space-y-4">
              {Object.entries(latestDeck.sections)
                .filter(([key]) => key !== "extractedKeywords")
                .map(([key, value]) => (
                  <div key={key}>
                    <p className="label mb-1">{key.replace(/([A-Z])/g, " $1").replace("Slide", "").trim()}</p>
                    <p className="text-sm leading-relaxed">{String(value)}</p>
                  </div>
                ))}
            </div>
          ) : (
            <p className="text-ink-soft text-sm">Deck saved, but no generated slide sections are available.</p>
          )}
        </section>

        {/* --- Campaign section --- */}
        <section className="card p-6 animate-fade-up">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-lg">Investor matches</h2>
            {!drafts && (
              <button className="btn-primary" onClick={handleLaunchCampaign} disabled={!hasDeck || creatingCampaign}>
                {creatingCampaign ? "Matching…" : "Find matched investors"}
              </button>
            )}
          </div>

          {!hasDeck && <p className="text-ink-soft text-sm">Add a deck first (generate or upload) before matching investors.</p>}

          {hasDeck && previewError && (
            <p className="text-sm text-danger bg-danger-soft border border-danger/20 rounded px-3 py-2 mb-4">
              {previewError}
            </p>
          )}

          {hasDeck && preview && !drafts && (
            <div className="mb-5">
              <div className="flex items-end justify-between gap-4 mb-3">
                <div>
                  <p className="text-3xl font-display">{preview.total.toLocaleString()}</p>
                  <p className="text-xs text-ink-soft">
                    {preview.mode === "verified"
                      ? "qualified investor matches found"
                      : "investor contacts available; thesis enrichment pending"}
                  </p>
                </div>
                <button className="btn-primary" onClick={handleLaunchCampaign} disabled={creatingCampaign}>
                  {creatingCampaign ? "Starting..." : "Start campaign"}
                </button>
              </div>
              <div className="grid gap-2">
                {preview.investors.map((investor) => (
                  <div key={investor.id} className="border border-line-soft rounded p-3 flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{investor.name}</p>
                      <p className="text-xs text-ink-soft">{investor.firm}</p>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {investor.reasons.slice(0, 3).map((reason, i) => (
                          <span key={i} className="text-[11px] bg-verified-soft text-verified px-2 py-0.5 rounded">
                            {reason}
                          </span>
                        ))}
                      </div>
                    </div>
                    {investor.score !== null ? (
                      <div className="shrink-0">
                        <MatchStamp score={investor.score} size={32} />
                      </div>
                    ) : (
                      <span className="label">Imported</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {campaignError && (
            <p className="text-sm text-danger bg-danger-soft border border-danger/20 rounded px-3 py-2 mb-4">
              {campaignError}
            </p>
          )}

          {tierInfo && (
            <p className="text-xs text-ink-soft mb-4">
              {tierInfo.name} — {tierInfo.priceInr != null ? `₹${tierInfo.priceInr.toLocaleString()} ${tierInfo.billing === "one_time" ? "one-time" : "/mo"}` : "Custom pricing"}
            </p>
          )}

          {drafts && (
            <div className="space-y-3">
              {drafts.map((d) => (
                <details key={d.id} className="border border-line-soft rounded p-4 animate-fade-up">
                  <summary className="flex items-center justify-between cursor-pointer list-none">
                    <div className="flex items-center gap-3">
                      <MatchStamp score={d.matchScore} size={36} />
                      <div>
                        <p className="text-sm font-medium">{d.subject}</p>
                        <p className="text-xs text-ink-soft">{d.matchReasons[0]}</p>
                      </div>
                    </div>
                    <span className="label">{d.status}</span>
                  </summary>
                  <div className="mt-4 pt-4 border-t border-line-soft">
                    <p className="text-sm whitespace-pre-line mb-3">{d.bodyText}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {d.matchReasons.map((r, i) => (
                        <span key={i} className="text-[11px] bg-verified-soft text-verified px-2 py-0.5 rounded">
                          {r}
                        </span>
                      ))}
                    </div>
                  </div>
                </details>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
