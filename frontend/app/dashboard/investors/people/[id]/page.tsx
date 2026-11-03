"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, errorMessage } from "@/lib/api";
import { useWorkspace, withCompany } from "@/lib/workspace";
import { ErrorState, humanize, investorTypeLabel, LoadingSkeleton, Notice, Page, PageHeader, Section } from "@/components/ui";
import { checkRange, Match, MatchBreakdown, SelectionTray, setList, useSelection } from "@/components/investors/shared";

interface Person {
  id: string;
  name: string;
  title: string | null;
  linkedinUrl: string | null;
  firm: string;
  fundKey: string;
  investorType: string | null;
  stageFocus: string[];
  sectorFocus: string[];
  geoFocus: string[];
  thesisKeywords: string[];
  portfolio: string[];
  checkSizeMinUsd: number | null;
  checkSizeMaxUsd: number | null;
  leadsRounds: boolean | null;
  source: string | null;
  sourceVerifiedAt: string | null;
  match: Match | null;
  notMatchedReason: string | null;
  saved: boolean;
  alreadyContacted: boolean;
}

export default function PersonPage() {
  const { id } = useParams<{ id: string }>();
  const { companyId } = useWorkspace();
  const sel = useSelection();
  const [p, setP] = useState<Person | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<Person>(withCompany(`/api/discovery/people/${id}`, companyId))
      .then(setP)
      .catch((err) => setError(errorMessage(err, "Couldn't load this investor.")));
  }, [id, companyId]);
  useEffect(load, [load]);

  if (error) return <Page><ErrorState message={error} onRetry={load} /></Page>;
  if (!p) return <Page><LoadingSkeleton rows={3} /></Page>;

  return (
    <Page>
      <PageHeader
        crumbs={[{ label: "Investor Discovery", href: "/dashboard/investors" }, { label: p.firm, href: `/dashboard/investors/funds/${encodeURIComponent(p.fundKey)}` }, { label: p.name }]}
        title={p.name}
        description={
          <>
            {p.title ? `${p.title} at ` : ""}
            <Link href={`/dashboard/investors/funds/${encodeURIComponent(p.fundKey)}`} className="text-navy hover:underline">
              {p.firm}
            </Link>
          </>
        }
        actions={
          <>
            {p.linkedinUrl && (
              <a href={p.linkedinUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary">
                LinkedIn
              </a>
            )}
            <button className="btn-secondary" onClick={async () => (await setList(companyId, p.id, p.saved ? null : "SAVED")) && load()}>
              {p.saved ? "Saved" : "Save"}
            </button>
            {p.match && (
              <button className={sel.has(p.id) ? "btn-secondary" : "btn-primary"} onClick={() => sel.toggle(p.id)} disabled={p.alreadyContacted}>
                {p.alreadyContacted ? "Already contacted" : sel.has(p.id) ? "Remove from selection" : "Add to campaign"}
              </button>
            )}
          </>
        }
      />
      {!p.match && (
        <div className="mb-6">
          <Notice>Not a match for your company: {p.notMatchedReason}</Notice>
        </div>
      )}
      <div className="grid lg:grid-cols-3 gap-6">
        {p.match && (
          <div className="lg:col-span-2">
            <Section title="Why this person" description="Every reason comes from fields on your profile and this investor's record.">
              {p.match.reasons.length > 0 && (
                <ul className="list-disc pl-5 text-sm text-ink space-y-1 mb-5">
                  {p.match.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
              <MatchBreakdown match={p.match} />
            </Section>
          </div>
        )}
        <Section title="Investor details">
          <dl className="space-y-3 text-sm">
            {(
              [
                ["Type", p.investorType ? investorTypeLabel(p.investorType) : "Not listed"],
                ["Stages", p.stageFocus.map(humanize).join(", ") || "Not listed"],
                ["Sectors", p.sectorFocus.join(", ") || "Not listed"],
                ["Geography", p.geoFocus.join(", ") || "Not listed"],
                ["Check size", checkRange(p.checkSizeMinUsd, p.checkSizeMaxUsd)],
                ["Leads rounds", p.leadsRounds == null ? "Unknown" : p.leadsRounds ? "Yes" : "Usually follows"],
                ["Thesis", p.thesisKeywords.join(", ") || "Not listed"],
                ["Source", `${p.source ?? "Imported"}${p.sourceVerifiedAt ? ` · verified ${new Date(p.sourceVerifiedAt).toLocaleDateString()}` : ""}`],
              ] as [string, string][]
            ).map(([k, v]) => (
              <div key={k}>
                <dt className="label">{k}</dt>
                <dd className="text-ink mt-0.5">{v}</dd>
              </div>
            ))}
          </dl>
        </Section>
      </div>
      <div className="h-24" aria-hidden />
      <SelectionTray companyId={companyId} />
    </Page>
  );
}
