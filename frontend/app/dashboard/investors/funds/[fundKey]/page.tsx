"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, errorMessage } from "@/lib/api";
import { useWorkspace, withCompany } from "@/lib/workspace";
import { ErrorState, humanize, investorTypeLabel, LoadingSkeleton, Page, PageHeader, ScorePill, Section, StatusBadge } from "@/components/ui";
import { checkRange, Match, SelectionTray, useSelection } from "@/components/investors/shared";

interface Fund {
  fundKey: string;
  firm: string;
  description: string | null;
  website: string | null;
  investorTypes: string[];
  stages: string[];
  sectors: string[];
  subSectors: string[];
  geographies: string[];
  thesisKeywords: string[];
  portfolio: string[];
  checkSizeMinUsd: number | null;
  checkSizeMaxUsd: number | null;
  fundStatus: "ACTIVE" | "NOT_INVESTING" | "UNKNOWN";
  people: { id: string; name: string; title: string | null; linkedinUrl: string | null; match: Match | null; notMatchedReason: string | null; saved: boolean; alreadyContacted: boolean }[];
}

export default function FundPage() {
  const { fundKey } = useParams<{ fundKey: string }>();
  const { companyId } = useWorkspace();
  const sel = useSelection();
  const [fund, setFund] = useState<Fund | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<Fund>(withCompany(`/api/discovery/funds/${encodeURIComponent(decodeURIComponent(fundKey))}`, companyId))
      .then(setFund)
      .catch((err) => setError(errorMessage(err, "Couldn't load this fund.")));
  }, [fundKey, companyId]);
  useEffect(load, [load]);

  if (error) return <Page><ErrorState message={error} onRetry={load} /></Page>;
  if (!fund) return <Page><LoadingSkeleton rows={3} /></Page>;

  const facts: [string, React.ReactNode][] = [
    ["Stages", fund.stages.map(humanize).join(", ") || "Not listed"],
    ["Sectors", [...fund.sectors, ...fund.subSectors].join(", ") || "Not listed"],
    ["Geography", fund.geographies.join(", ") || "Not listed"],
    ["Check size", checkRange(fund.checkSizeMinUsd, fund.checkSizeMaxUsd)],
    ["Type", fund.investorTypes.map(investorTypeLabel).join(", ") || "Not listed"],
  ];
  const matched = fund.people.filter((p) => p.match);
  return (
    <Page>
      <PageHeader
        crumbs={[{ label: "Investor Discovery", href: "/dashboard/investors" }, { label: "Funds", href: "/dashboard/investors?view=funds" }, { label: fund.firm }]}
        title={fund.firm}
        description={fund.description ?? "No fund description on record yet."}
        actions={fund.website ? <a href={fund.website} target="_blank" rel="noopener noreferrer" className="btn-secondary">Website</a> : undefined}
      />
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Section title="People at this fund" description={`${matched.length} of ${fund.people.length} match your company. The highest-scoring person is usually the right first contact.`}>
            <ul className="divide-y divide-line-soft -mx-1">
              {fund.people.map((p, i) => (
                <li key={p.id} className="py-3 px-1 flex items-start gap-3">
                  {p.match ? <ScorePill score={p.match.score} coverage={p.match.coverage} /> : <span className="min-w-[2.75rem] text-center text-xs text-ink-soft pt-1">—</span>}
                  <div className="flex-1 min-w-0">
                    <Link href={`/dashboard/investors/people/${p.id}`} className="text-sm text-navy font-medium hover:underline">
                      {p.name}
                    </Link>
                    {i === 0 && p.match && <span className="chip ml-2 bg-verified-soft text-verified border-verified/20">Recommended contact</span>}
                    <p className="text-xs text-ink-soft">{p.title ?? "Title not listed"}</p>
                    {p.match ? <p className="text-xs text-ink mt-1">{p.match.reasons.slice(0, 2).join(" · ")}</p> : <p className="text-xs text-ink-soft mt-1">Not a match: {p.notMatchedReason}</p>}
                  </div>
                  {p.match && (
                    <button className={sel.has(p.id) ? "btn-primary text-xs" : "btn-secondary text-xs"} onClick={() => sel.toggle(p.id)} disabled={p.alreadyContacted} aria-pressed={sel.has(p.id)}>
                      {p.alreadyContacted ? "Contacted" : sel.has(p.id) ? "Selected" : "Add"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </Section>
          {fund.thesisKeywords.length > 0 && (
            <Section title="Investment thesis">
              <div className="flex flex-wrap gap-1.5">
                {fund.thesisKeywords.map((t) => (
                  <span key={t} className="chip">
                    {t}
                  </span>
                ))}
              </div>
            </Section>
          )}
        </div>
        <div className="space-y-6">
          <Section title="Fund overview">
            <dl className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <dt className="label">Status</dt>
                <dd>
                  <StatusBadge status={fund.fundStatus} label={fund.fundStatus === "ACTIVE" ? "Investing" : fund.fundStatus === "NOT_INVESTING" ? "Not investing" : "Unverified"} />
                </dd>
              </div>
              {facts.map(([k, v]) => (
                <div key={k}>
                  <dt className="label">{k}</dt>
                  <dd className="text-ink mt-0.5">{v}</dd>
                </div>
              ))}
            </dl>
          </Section>
          <Section title="Portfolio">
            {fund.portfolio.length ? (
              <ul className="text-sm text-ink space-y-1">
                {fund.portfolio.slice(0, 20).map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-soft">No portfolio companies on record.</p>
            )}
          </Section>
        </div>
      </div>
      <div className="h-24" aria-hidden />
      <SelectionTray companyId={companyId} />
    </Page>
  );
}
