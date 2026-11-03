"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { api, errorMessage } from "@/lib/api";
import { useWorkspace, withCompany } from "@/lib/workspace";
import { EmptyState, ErrorState, LoadingSkeleton, Notice, Page, PageHeader, ProgressBar, Tabs } from "@/components/ui";
import { DocumentsEditor, FoundersEditor, FundraisingEditor, OverviewEditor, PreferencesEditor, ProductMarketEditor, TractionEditor } from "@/components/profile/Sections";
import { IntelligenceReview } from "@/components/profile/IntelligenceReview";
import { Profile } from "@/components/profile/types";

const SECTIONS = [
  { key: "overview", label: "Company overview", section: "overview" },
  { key: "founders", label: "Founders", section: "founders" },
  { key: "product", label: "Product & market", section: "productMarket" },
  { key: "traction", label: "Traction & financials", section: "traction" },
  { key: "fundraising", label: "Fundraising", section: "fundraising" },
  { key: "preferences", label: "Investor preferences", section: "preferences" },
  { key: "documents", label: "Documents", section: "documents" },
  { key: "intelligence", label: "Profile summary", section: "intelligence" },
] as const;

export default function CompanyPage() {
  return (
    <Suspense fallback={<Page><LoadingSkeleton /></Page>}>
      <Company />
    </Suspense>
  );
}

function Company() {
  const params = useSearchParams();
  const { companyId, setCompanyId, companies, refreshCompanies } = useWorkspace();
  // Links from older pages (/company/:id) carry the company explicitly.
  const linked = params.get("companyId");
  useEffect(() => {
    if (linked && linked !== companyId && companies?.some((c) => c.id === linked)) setCompanyId(linked);
  }, [linked, companyId, companies, setCompanyId]);
  const active = SECTIONS.find((s) => s.key === params.get("section"))?.key ?? "overview";
  const field = params.get("field");
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api
      .get<Profile | Record<string, never>>(withCompany("/api/company-profile", companyId))
      .then((p) => setProfile(p && "id" in p ? (p as Profile) : null))
      .catch((err) => setError(errorMessage(err, "Couldn't load your company profile.")));
  }, [companyId]);
  useEffect(load, [load]);

  // Deep links from recommendations focus the exact field.
  useEffect(() => {
    if (!field || !profile) return;
    const t = setTimeout(() => {
      const el = document.getElementById(`field-${field}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      el?.focus({ preventScroll: true });
    }, 250);
    return () => clearTimeout(t);
  }, [field, profile, active]);

  const onSaved = useCallback(
    (p: Profile) => {
      setProfile(p);
      if (p.overview.name) refreshCompanies();
    },
    [refreshCompanies]
  );

  if (error) return <Page><ErrorState message={error} onRetry={load} /></Page>;
  if (profile === undefined) return <Page><LoadingSkeleton rows={4} /></Page>;
  if (profile === null) {
    return (
      <Page>
        <EmptyState title="No company profile yet" description="Build your profile to unlock investor matching." action={<Link href="/onboarding" className="btn-primary">Build profile</Link>} />
      </Page>
    );
  }

  const missingHere = (key: string) => {
    const section = SECTIONS.find((s) => s.key === key)?.section;
    return profile.completeness.missingRequired.filter((m) => m.section === section).length;
  };
  const props = { profile, onSaved };

  return (
    <Page width="page">
      <PageHeader
        title="My Company"
        description="Everything investors and our matching engine know about you. Changes save automatically and update your matches."
        actions={
          <Link href="/dashboard/investors" className="btn-primary">
            View investor matches
          </Link>
        }
      />
      <div className="card p-4 mb-6 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1">
          <ProgressBar value={profile.completeness.percent} label="Profile completeness" />
        </div>
        <p className="text-xs text-ink-soft shrink-0">
          {profile.completeness.percent}% complete
          {profile.intelligence?.status === "CONFIRMED" ? " · summary confirmed" : profile.intelligence ? " · summary needs review" : ""}
        </p>
      </div>
      {!profile.onboarding.completedAt && (
        <div className="mb-6">
          <Notice action={<Link href="/onboarding" className="btn-secondary text-xs">Continue onboarding</Link>}>Onboarding isn't finished yet — your profile isn't used for matching until it is.</Notice>
        </div>
      )}
      <Tabs
        label="Profile sections"
        active={active}
        tabs={SECTIONS.map((s) => ({ key: s.key, label: `${s.label}${missingHere(s.key) ? " •" : ""}`, href: `/dashboard/company?section=${s.key}` }))}
      />
      <div className="card p-5 sm:p-8" key={active}>
        {active === "overview" && <OverviewEditor {...props} />}
        {active === "founders" && <FoundersEditor {...props} />}
        {active === "product" && <ProductMarketEditor {...props} />}
        {active === "traction" && <TractionEditor {...props} />}
        {active === "fundraising" && <FundraisingEditor {...props} />}
        {active === "preferences" && <PreferencesEditor {...props} />}
        {active === "documents" && <DocumentsEditor {...props} />}
        {active === "intelligence" && (
          <div>
            <h2 className="font-display text-xl mb-1">Profile summary</h2>
            <p className="text-sm text-ink-soft mb-5">How GoPitch understands your company. Every line shows whether it came from your answers or was classified or inferred.</p>
            <IntelligenceReview profile={profile} onConfirmed={load} />
          </div>
        )}
      </div>
      <p className="text-xs text-ink-soft mt-6">
        Raising for another company?{" "}
        <Link href="/onboarding?new=1" className="text-verified hover:underline">
          Add a company
        </Link>
      </p>
    </Page>
  );
}
