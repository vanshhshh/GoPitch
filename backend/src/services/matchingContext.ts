/**
 * Builds matching inputs from the database: the company side (profile v2 + founders +
 * preferences + confirmed/draft intelligence + saved/excluded lists) and the investor
 * side (verified, enriched investors). Shared by investor discovery and campaigns so
 * both always rank identically.
 */
import { pool, Queryable } from "../lib/db";
import { matchingSignals } from "./companyIntelligence";
import {
  CompanyProfile,
  DEFAULT_WEIGHTS,
  fundKey,
  InvestorProfile,
  MatchResult,
  MatchWeights,
  rankInvestors,
  resolveMatchingKeywords,
  validateWeights,
  WarmthRecord,
} from "./matchingService";

const REVENUE_KEYS = ["mrrUsd", "arrUsd", "monthlyRevenueUsd", "gmvMonthlyUsd", "payingCustomers"];

let weightsCache: { weights: MatchWeights; at: number } | null = null;

export async function loadWeights(db: Queryable = pool): Promise<MatchWeights> {
  if (weightsCache && Date.now() - weightsCache.at < 60_000) return weightsCache.weights;
  const row = (await db.query("SELECT weights FROM matching_config WHERE id = 'default'")).rows[0];
  const checked = row ? validateWeights(row.weights) : null;
  const weights = checked?.ok ? checked.weights : DEFAULT_WEIGHTS;
  weightsCache = { weights, at: Date.now() };
  return weights;
}

export async function saveWeights(input: unknown, adminId: string, db: Queryable = pool): Promise<MatchWeights> {
  const checked = validateWeights(input);
  if (!checked.ok) throw new Error(checked.error);
  await db.query(
    `INSERT INTO matching_config (id, weights, updated_by, updated_at) VALUES ('default', $1, $2, now())
     ON CONFLICT (id) DO UPDATE SET weights = $1, updated_by = $2, updated_at = now()`,
    [checked.weights, adminId]
  );
  weightsCache = null;
  return checked.weights;
}

export function toInvestorProfile(row: any): InvestorProfile {
  return {
    id: row.id,
    name: row.name,
    firm: row.firm,
    title: row.title,
    stageFocus: row.stage_focus ?? [],
    sectorFocus: row.sector_focus ?? [],
    geoFocus: row.geo_focus ?? [],
    checkSizeMinUsd: row.check_size_min_usd,
    checkSizeMaxUsd: row.check_size_max_usd,
    thesisKeywords: row.thesis_keywords ?? [],
    lastKnownActiveAt: row.last_known_active_at ? new Date(row.last_known_active_at) : null,
    isVerified: row.is_verified,
    investorType: row.investor_type ?? null,
    subSectors: row.sub_sectors ?? [],
    businessModels: row.business_models ?? [],
    leadsRounds: row.leads_rounds ?? null,
    fundStatus: row.fund_status ?? "UNKNOWN",
    tractionRequirement: row.traction_requirement ?? null,
    founderPreferences: row.founder_preferences ?? [],
    portfolioCompanies: row.portfolio_companies ?? [],
  };
}

export async function buildCompanyProfile(company: any, db: Queryable = pool): Promise<CompanyProfile> {
  const founders = (await db.query("SELECT domain_expertise, skills, previous_founder FROM company_founders WHERE company_id = $1", [company.id])).rows;
  const signals = await matchingSignals(company.id, db);
  const lists = (await db.query("SELECT investor_id FROM company_investor_lists WHERE company_id = $1 AND list = 'EXCLUDED'", [company.id])).rows;
  const prefs = company.investor_preferences ?? {};
  const traction = company.traction_metrics ?? {};
  const productStage: string | null = company.product_stage ?? null;

  const founderSignals = new Set<string>();
  for (const f of founders) {
    (f.domain_expertise ?? []).forEach((d: string) => founderSignals.add(d));
    if ((f.skills ?? []).includes("TECHNICAL")) founderSignals.add("technical");
    if (f.previous_founder) founderSignals.add("repeat");
  }

  // Revenue is known only if the founder said so (metrics) or the product stage implies none.
  const hasRevenueMetric = REVENUE_KEYS.some((k) => typeof traction[k] === "number" && traction[k] > 0);
  const hasRevenue = hasRevenueMetric ? true : productStage && ["IDEA", "PROTOTYPE"].includes(productStage) ? false : null;

  return {
    stage: company.stage ?? null,
    sector: company.sector ?? [],
    geography: company.geography ?? [],
    askAmountUsd: company.ask_amount_usd ?? null,
    extractedKeywords: resolveMatchingKeywords(company.extracted_keywords ?? [], company.sector ?? []),
    subIndustries: [...new Set([...(company.sub_industry ?? []), ...signals.subIndustry])],
    businessTypes: company.business_type ?? [],
    headquarters: company.headquarters ?? null,
    preferredCheck: { min: prefs.minCheckUsd ?? null, max: prefs.maxCheckUsd ?? null },
    thesisTerms: signals.thesis,
    founderSignals: [...founderSignals],
    hasRevenue,
    excludedSectors: prefs.excludedSectors ?? [],
    excludedInvestorIds: lists.map((l) => l.investor_id),
    excludedNames: prefs.excludedInvestors ?? [],
    preferredInvestorTypes: prefs.investorTypes ?? [],
    leadPreference: prefs.leadPreference ?? null,
  };
}

export interface RankedCompany {
  company: any;
  investors: Map<string, InvestorProfile>;
  ranked: MatchResult[];
  alreadyContacted: Set<string>;
  saved: Set<string>;
  previouslyContactedFunds: Set<string>;
  matchableCount: number;
}

/**
 * Ranks every matchable investor for one of the founder's companies. Returns null when the
 * company isn't theirs, "incomplete" when there's not enough profile to match on.
 */
export async function rankForCompany(userId: string, companyId: string, db: Queryable = pool): Promise<RankedCompany | "incomplete" | null> {
  const company = (await db.query("SELECT * FROM companies WHERE id = $1 AND user_id = $2", [companyId, userId])).rows[0];
  if (!company) return null;
  if (!company.stage || !(company.sector ?? []).length) return "incomplete";

  const profile = await buildCompanyProfile(company, db);
  const investorRows = await db.query("SELECT * FROM investors WHERE is_verified = true AND needs_enrichment = false");
  const investors = new Map<string, InvestorProfile>(investorRows.rows.map((r) => [r.id, toInvestorProfile(r)]));
  const warmthRows = await db.query("SELECT investor_id, status FROM investor_warmth WHERE user_id = $1", [userId]);
  const warmth = new Map<string, WarmthRecord>(warmthRows.rows.map((w) => [w.investor_id, { investorId: w.investor_id, status: w.status }]));
  const contacted = await db.query("SELECT DISTINCT investor_id FROM email_sends WHERE user_id = $1 AND status <> 'CANCELLED'", [userId]);
  const saved = await db.query("SELECT investor_id FROM company_investor_lists WHERE company_id = $1 AND list = 'SAVED'", [companyId]);

  return {
    company,
    investors,
    ranked: rankInvestors(profile, [...investors.values()], warmth, investors.size, new Date(), await loadWeights(db)),
    alreadyContacted: new Set(contacted.rows.map((r) => r.investor_id)),
    saved: new Set(saved.rows.map((r) => r.investor_id)),
    previouslyContactedFunds: new Set((company.investor_preferences?.previouslyContactedFunds ?? []).map(fundKey)),
    matchableCount: investors.size,
  };
}

export function toMatchResponse(r: RankedCompany, m: MatchResult) {
  const inv = r.investors.get(m.investorId)!;
  return {
    id: inv.id,
    name: inv.name,
    title: inv.title ?? null,
    firm: inv.firm,
    fundKey: fundKey(inv.firm),
    investorType: inv.investorType ?? null,
    stageFocus: inv.stageFocus,
    sectorFocus: inv.sectorFocus,
    geoFocus: inv.geoFocus,
    checkSizeMinUsd: inv.checkSizeMinUsd,
    checkSizeMaxUsd: inv.checkSizeMaxUsd,
    score: m.score,
    coverage: m.coverage,
    reasons: m.reasons,
    mismatches: m.mismatches,
    missing: m.missing,
    components: m.components,
    alreadyContacted: r.alreadyContacted.has(inv.id),
    saved: r.saved.has(inv.id),
    fundPreviouslyContacted: r.previouslyContactedFunds.has(fundKey(inv.firm)),
  };
}
