"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Users } from "lucide-react";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useWorkspace, withCompany } from "@/lib/workspace";
import { EmptyState, ErrorState, FilterBar, humanize, investorTypeLabel, LoadingSkeleton, Page, PageHeader, ScorePill, SearchInput, SelectFilter, Tabs, useDebounced } from "@/components/ui";
import { DetailDrawer } from "@/components/ui/overlays";
import { Pagination } from "@/components/Pagination";
import { checkRange, InvestorCard, Match, MatchBreakdown, SelectionTray, setList, useSelection } from "@/components/investors/shared";

interface FundRow {
  fundKey: string;
  firm: string;
  bestScore: number;
  peopleCount: number;
  stages: string[];
  sectors: string[];
  geographies: string[];
  checkSizeMinUsd: number | null;
  checkSizeMaxUsd: number | null;
  recommendedContact: { id: string; name: string; title: string | null; score: number; reasons: string[] };
  alreadyContacted: boolean;
}

interface Result {
  view: "people" | "funds";
  total: number;
  totalMatches: number;
  totalFunds: number;
  matchableInvestors?: number;
  page: number;
  pageSize: number;
  items: any[];
}

const STAGES = [
  ["IDEA", "Idea"],
  ["PRE_SEED", "Pre-seed"],
  ["SEED", "Seed"],
  ["SERIES_A", "Series A"],
  ["SERIES_B_PLUS", "Series B+"],
].map(([value, label]) => ({ value, label }));
const TYPES = ["VC", "MICRO_VC", "ANGEL", "ANGEL_NETWORK", "CVC", "ACCELERATOR", "FAMILY_OFFICE", "SYNDICATE"].map((v) => ({ value: v, label: investorTypeLabel(v) }));

export default function DiscoveryPage() {
  return (
    <Suspense fallback={<Page><LoadingSkeleton /></Page>}>
      <Discovery />
    </Suspense>
  );
}

function Discovery() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { companyId } = useWorkspace();
  const sel = useSelection();

  // URL is the source of truth for filters, so Back/refresh restore the exact view.
  const view = params.get("view") === "funds" ? "funds" : "people";
  const list = (params.get("list") as "saved" | "excluded" | null) ?? "all";
  const page = Number(params.get("page") ?? 1) || 1;
  const filters = { stage: params.get("stage") ?? "", sector: params.get("sector") ?? "", geo: params.get("geo") ?? "", investorType: params.get("investorType") ?? "", minScore: params.get("minScore") ?? "" };
  const [q, setQ] = useState(params.get("q") ?? "");
  const debouncedQ = useDebounced(q);

  const update = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
      if (!("page" in patch)) next.delete("page");
      router.replace(`${pathname}?${next}`, { scroll: false });
    },
    [params, pathname, router]
  );
  useEffect(() => {
    if ((params.get("q") ?? "") !== debouncedQ) update({ q: debouncedQ || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState<{ message: string; incomplete?: boolean } | null>(null);
  const [allowance, setAllowance] = useState<{ tier: string; remainingToAllocate: number } | null>(null);
  const [open, setOpen] = useState<Match | null>(null);
  const [version, setVersion] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilters = Object.values(filters).filter(Boolean).length;

  const query = useMemo(() => {
    const s = new URLSearchParams({ view, list, page: String(page), pageSize: "20" });
    if (debouncedQ) s.set("q", debouncedQ);
    for (const [k, v] of Object.entries(filters)) if (v) s.set(k, v);
    return withCompany(`/api/discovery/matches?${s}`, companyId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, list, page, debouncedQ, filters.stage, filters.sector, filters.geo, filters.investorType, filters.minScore, companyId]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .get<Result>(query)
      .then((d) => !cancelled && setData(d))
      .catch((err) => !cancelled && setError({ message: errorMessage(err, "Couldn't load matches."), incomplete: err instanceof ApiError && err.body?.incomplete }));
    return () => {
      cancelled = true;
    };
  }, [query, version]);
  useEffect(() => {
    api.get<{ tier: string; remainingToAllocate: number }>("/api/discovery/allowance").then(setAllowance).catch(() => {});
  }, []);

  const refresh = () => setVersion((v) => v + 1);
  const tabs = [
    { key: "people", label: "All matches", href: "/dashboard/investors", count: data?.totalMatches },
    { key: "funds", label: "Funds", href: "/dashboard/investors?view=funds", count: data?.totalFunds },
    { key: "saved", label: "Saved", href: "/dashboard/investors?list=saved" },
    { key: "excluded", label: "Excluded", href: "/dashboard/investors?list=excluded" },
  ];
  const activeTab = list !== "all" ? list : view;

  return (
    <Page>
      <PageHeader
        title="Investor Discovery"
        description="Investors who pass every hard filter for your company, ranked by fit. Funds are firms; people are the partners you'd actually email."
        actions={sel.ids.length > 0 ? <Link href="/dashboard/outreach/new" className="btn-primary">Create campaign ({sel.ids.length})</Link> : undefined}
      />
      {allowance && (
        <p className="text-xs text-ink-soft mb-4">
          Your {allowance.tier === "FREE" ? "Free" : allowance.tier.toLowerCase()} plan lets you contact <span className="text-navy font-medium">{allowance.remainingToAllocate}</span> more investors.{" "}
          {allowance.remainingToAllocate === 0 && (
            <Link href="/dashboard/billing" className="text-verified hover:underline">
              Upgrade
            </Link>
          )}
        </p>
      )}
      <Tabs label="Discovery views" active={activeTab} tabs={tabs} />

      {list !== "excluded" && (
        <FilterBar>
          <div className="flex gap-2">
            <SearchInput value={q} onChange={setQ} placeholder="Search investor, fund or title" label="Search investors" />
            <button className="btn-secondary sm:hidden shrink-0" onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen} aria-controls="discovery-filters">
              Filters{activeFilters ? ` (${activeFilters})` : ""}
            </button>
          </div>
          <div id="discovery-filters" className={`${filtersOpen ? "flex" : "hidden"} sm:contents flex-col gap-2`}>
          <SelectFilter label="Stage" value={filters.stage} onChange={(v) => update({ stage: v })} options={STAGES} />
          <SelectFilter label="Investor type" value={filters.investorType} onChange={(v) => update({ investorType: v })} options={TYPES} />
          <input className="input-field sm:w-36" placeholder="Sector" aria-label="Sector filter" defaultValue={filters.sector} onBlur={(e) => update({ sector: e.target.value.trim() })} onKeyDown={(e) => e.key === "Enter" && update({ sector: (e.target as HTMLInputElement).value.trim() })} />
          <input className="input-field sm:w-36" placeholder="Geography" aria-label="Geography filter" defaultValue={filters.geo} onBlur={(e) => update({ geo: e.target.value.trim() })} onKeyDown={(e) => e.key === "Enter" && update({ geo: (e.target as HTMLInputElement).value.trim() })} />
          <SelectFilter
            label="Min score"
            value={filters.minScore}
            onChange={(v) => update({ minScore: v })}
            options={[
              { value: "50", label: "50+" },
              { value: "75", label: "75+" },
            ]}
          />
          </div>
        </FilterBar>
      )}

      {error ? (
        error.incomplete ? (
          <EmptyState title="Your profile needs a little more" description={error.message} action={<Link href="/dashboard/company?section=fundraising" className="btn-primary">Update profile</Link>} />
        ) : (
          <ErrorState message={error.message} onRetry={refresh} />
        )
      ) : !data ? (
        <LoadingSkeleton rows={5} label="Loading matches" />
      ) : data.items.length === 0 ? (
        <EmptyResult data={data} list={list} filtered={!!(debouncedQ || Object.values(filters).some(Boolean))} />
      ) : list === "excluded" ? (
        <ul className="card divide-y divide-line-soft">
          {data.items.map((x: any) => (
            <li key={x.id} className="p-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm text-navy">{x.name}</p>
                <p className="text-xs text-ink-soft">{x.firm.trim()}</p>
              </div>
              <button className="btn-secondary text-xs" onClick={async () => (await setList(companyId, x.id, null)) && refresh()}>
                Restore
              </button>
            </li>
          ))}
        </ul>
      ) : view === "funds" ? (
        <div className="grid md:grid-cols-2 gap-3">
          {(data.items as FundRow[]).map((f) => (
            <Link key={f.fundKey} href={`/dashboard/investors/funds/${encodeURIComponent(f.fundKey)}`} className="card p-4 hover:border-ink-soft block">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-display text-lg truncate">{f.firm}</h3>
                  <p className="text-xs text-ink-soft">
                    {f.peopleCount} matched {f.peopleCount === 1 ? "person" : "people"} · {f.stages.map(humanize).join(", ") || "stages n/a"}
                  </p>
                </div>
                <ScorePill score={f.bestScore} />
              </div>
              <p className="text-xs text-ink-soft mt-2">
                {f.sectors.slice(0, 4).join(", ")} · {checkRange(f.checkSizeMinUsd, f.checkSizeMaxUsd)}
              </p>
              <p className="text-sm mt-3">
                <span className="text-ink-soft">Best contact: </span>
                <span className="text-navy">{f.recommendedContact.name}</span>
                {f.recommendedContact.title && <span className="text-ink-soft"> · {f.recommendedContact.title}</span>}
              </p>
              {f.alreadyContacted && <span className="chip mt-2">Someone here contacted</span>}
            </Link>
          ))}
        </div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-3">
          {(data.items as Match[]).map((m) => (
            <InvestorCard key={m.id} m={m} companyId={companyId} selected={sel.has(m.id)} onToggleSelect={() => sel.toggle(m.id)} onOpen={() => setOpen(m)} onListChange={refresh} />
          ))}
        </div>
      )}
      {data && list !== "excluded" && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => update({ page: String(p) })} />}
      <div className="h-24" aria-hidden />

      <DetailDrawer
        open={!!open}
        onClose={() => setOpen(null)}
        title={open?.name ?? ""}
        footer={
          open && (
            <>
              <Link href={`/dashboard/investors/people/${open.id}`} className="btn-ghost text-sm">
                Full profile
              </Link>
              <button className={sel.has(open.id) ? "btn-secondary text-sm" : "btn-primary text-sm"} onClick={() => sel.toggle(open.id)} disabled={open.alreadyContacted}>
                {sel.has(open.id) ? "Remove from selection" : "Add to campaign"}
              </button>
            </>
          )
        }
      >
        {open && (
          <div className="space-y-5">
            <p className="text-sm text-ink-soft">
              {open.title ? `${open.title} at ` : ""}
              <Link href={`/dashboard/investors/funds/${encodeURIComponent(open.fundKey)}`} className="text-navy hover:underline">
                {open.firm.trim()}
              </Link>
            </p>
            <MatchBreakdown match={open} />
          </div>
        )}
      </DetailDrawer>
      <SelectionTray companyId={companyId} />
    </Page>
  );
}

function EmptyResult({ data, list, filtered }: { data: Result; list: string; filtered: boolean }) {
  if (filtered) return <EmptyState title="No investors match these filters" description="Try removing a filter or broadening your search." />;
  if (list === "saved") return <EmptyState title="No saved investors yet" description="Save investors from your matches to build a shortlist." action={<Link href="/dashboard/investors" className="btn-primary">Browse matches</Link>} />;
  if (list === "excluded") return <EmptyState title="Nothing excluded" description="Investors you exclude are listed here and never appear in your matches." />;
  return (
    <EmptyState
      icon={<Users size={18} />}
      title="No investors pass your filters yet"
      description={`We only show investors with real stage and sector fit — we don't pad the list. ${data.matchableInvestors != null ? `${data.matchableInvestors.toLocaleString()} verified investors were checked. ` : ""}Broadening your industry, sub-industry or geography usually helps.`}
      action={<Link href="/dashboard/company?section=overview&field=sector" className="btn-primary">Refine profile</Link>}
    />
  );
}

