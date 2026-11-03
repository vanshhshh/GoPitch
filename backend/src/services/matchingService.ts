/**
 * matchingService.ts — investor matching v2
 *
 * Two separate stages:
 *  1. Hard eligibility (pass/fail): verified contact, fund still investing, not excluded
 *     by the founder, compatible stage, overlapping sector, compatible geography, a
 *     cheque that isn't bigger than the whole round, and no prior "pass".
 *  2. Relevance score: configurable weights (validated to sum to 100) over eight
 *     components. A component is scored only when BOTH sides have real data; the score
 *     is re-normalised over the components with evidence, and `coverage` says how much
 *     of the weight that was. Components without investor data are reported as missing
 *     information instead of being guessed.
 *
 * Every reason in the output is built from fields on the two records — no generated
 * explanations.
 */

export type Stage = "IDEA" | "PRE_SEED" | "SEED" | "SERIES_A" | "SERIES_B_PLUS";

export const MATCH_COMPONENTS = ["sector", "stage", "checkSize", "thesis", "businessModel", "geography", "founderMarketFit", "tractionMandate"] as const;
export type MatchComponent = (typeof MATCH_COMPONENTS)[number];
export type MatchWeights = Record<MatchComponent, number>;

export const DEFAULT_WEIGHTS: MatchWeights = {
  sector: 20,
  stage: 15,
  checkSize: 15,
  thesis: 15,
  businessModel: 10,
  geography: 10,
  founderMarketFit: 10,
  tractionMandate: 5,
};

export const COMPONENT_LABELS: Record<MatchComponent, string> = {
  sector: "Sector / sub-sector",
  stage: "Investment stage",
  checkSize: "Check size",
  thesis: "Investment thesis",
  businessModel: "Business model",
  geography: "Geography",
  founderMarketFit: "Founder preferences",
  tractionMandate: "Traction / mandate",
};

export function validateWeights(input: unknown): { ok: true; weights: MatchWeights } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "Weights must be an object." };
  const w = input as Record<string, unknown>;
  const extra = Object.keys(w).filter((k) => !MATCH_COMPONENTS.includes(k as MatchComponent));
  if (extra.length) return { ok: false, error: `Unknown weight: ${extra.join(", ")}.` };
  const out = {} as MatchWeights;
  for (const k of MATCH_COMPONENTS) {
    const v = w[k];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100) return { ok: false, error: `${COMPONENT_LABELS[k]} weight must be 0–100.` };
    out[k] = v;
  }
  const total = MATCH_COMPONENTS.reduce((s, k) => s + out[k], 0);
  if (Math.abs(total - 100) > 0.001) return { ok: false, error: `Weights must add up to 100 (currently ${total}).` };
  return { ok: true, weights: out };
}

/**
 * Determines which keyword set to use for thesis matching: LLM-extracted deck keywords
 * when present, otherwise the founder's own sector tags.
 */
export function resolveMatchingKeywords(extractedKeywords: string[], sector: string[]): string[] {
  if (extractedKeywords && extractedKeywords.length > 0) return extractedKeywords;
  return sector ?? [];
}

export type WarmthStatus = "COLD" | "REPLIED_INTERESTED" | "REPLIED_PASS" | "REPLIED_NEEDS_INFO" | "MEETING_BOOKED";

export interface CompanyProfile {
  stage: Stage | null;
  sector: string[];
  geography: string[];
  askAmountUsd: number | null;
  extractedKeywords: string[];
  subIndustries?: string[];
  businessTypes?: string[];
  headquarters?: string | null;
  preferredCheck?: { min: number | null; max: number | null };
  thesisTerms?: string[];
  founderSignals?: string[];
  hasRevenue?: boolean | null;
  excludedSectors?: string[];
  excludedInvestorIds?: string[];
  excludedNames?: string[];
  preferredInvestorTypes?: string[];
  leadPreference?: "LEAD" | "FOLLOW" | "EITHER" | null;
}

export interface InvestorProfile {
  id: string;
  name: string;
  firm: string;
  title?: string | null;
  stageFocus: Stage[];
  sectorFocus: string[];
  geoFocus: string[];
  checkSizeMinUsd: number | null;
  checkSizeMaxUsd: number | null;
  thesisKeywords: string[];
  lastKnownActiveAt: Date | null;
  isVerified: boolean;
  investorType?: string | null;
  subSectors?: string[];
  businessModels?: string[];
  leadsRounds?: boolean | null;
  fundStatus?: "ACTIVE" | "NOT_INVESTING" | "UNKNOWN" | null;
  tractionRequirement?: "PRE_REVENUE_OK" | "REVENUE_REQUIRED" | null;
  founderPreferences?: string[];
  portfolioCompanies?: string[];
}

export interface WarmthRecord {
  investorId: string;
  status: WarmthStatus;
}

export interface ComponentResult {
  score: number | null; // 0..1, null = no evidence on one side
  weight: number;
  evidence: string | null;
}

export interface MatchResult {
  investorId: string;
  score: number; // 0-100, over components with evidence
  coverage: number; // 0-1 share of total weight that had evidence
  components: Record<MatchComponent, ComponentResult>;
  reasons: string[];
  mismatches: string[];
  missing: string[];
  excluded: boolean;
  exclusionReason?: string;
}

const STAGE_ORDER: Stage[] = ["IDEA", "PRE_SEED", "SEED", "SERIES_A", "SERIES_B_PLUS"];
const stageLabel = (s: string) => s.replace(/_/g, " ").toLowerCase();
const GLOBAL = new Set(["global", "worldwide", "any", "international"]);

export function normalizeMatchTerm(input: string): string {
  const value = input.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
  const aliases: Record<string, string> = {
    ai: "artificial intelligence",
    "ai ml": "artificial intelligence",
    ml: "artificial intelligence",
    "machine learning": "artificial intelligence",
    saas: "software as a service",
    "b2b saas": "software as a service",
    enterprise: "enterprise software",
    "enterprise saas": "enterprise software",
    usa: "united states",
    us: "united states",
    uk: "united kingdom",
    sea: "southeast asia",
    uae: "united arab emirates",
    d2c: "consumer brands",
    dtc: "consumer brands",
    "direct to consumer": "consumer brands",
  };
  return aliases[value] ?? value;
}

/** Normalized fund identity, so "Fund X" and " fund x " are one fund. */
export function fundKey(firm: string | null | undefined): string {
  return (firm || "").trim().toLowerCase().replace(/\s+/g, " ");
}

const norm = (xs: string[] | undefined) => new Set((xs ?? []).map(normalizeMatchTerm).filter(Boolean));
function overlap(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((x) => b.has(x));
}
const pretty = (xs: string[]) => xs.slice(0, 4).join(", ");

function stageDistance(company: Stage, investorStages: Stage[]): number {
  return Math.min(...investorStages.map((s) => Math.abs(STAGE_ORDER.indexOf(company) - STAGE_ORDER.indexOf(s))));
}

/** Hard filters. Returns the first failing reason, or null when eligible. */
export function eligibilityFailure(company: CompanyProfile, inv: InvestorProfile, warmth: WarmthRecord | null): string | null {
  if (warmth?.status === "REPLIED_PASS") return "Investor already passed on this founder in a prior campaign.";
  if (!inv.isVerified) return "Email not yet verified — excluded to protect sender deliverability.";
  if (inv.fundStatus === "NOT_INVESTING") return "Fund is marked as not currently investing.";
  if (company.excludedInvestorIds?.includes(inv.id)) return "You excluded this investor.";
  const excludedNames = norm(company.excludedNames);
  if (excludedNames.has(normalizeMatchTerm(inv.firm)) || excludedNames.has(normalizeMatchTerm(inv.name))) return "You excluded this investor or fund.";

  if (company.stage && inv.stageFocus.length && stageDistance(company.stage, inv.stageFocus) > 1) {
    return `Invests at ${inv.stageFocus.map(stageLabel).join(", ")}, not ${stageLabel(company.stage)}.`;
  }

  const companySectors = norm([...company.sector, ...(company.subIndustries ?? [])]);
  const investorSectors = norm([...inv.sectorFocus, ...(inv.subSectors ?? [])]);
  if (companySectors.size && investorSectors.size && overlap(companySectors, investorSectors).length === 0) {
    return "No overlap between your sector and the investor's sector focus.";
  }
  const excludedSectors = norm(company.excludedSectors);
  if (investorSectors.size && excludedSectors.size && [...investorSectors].every((s) => excludedSectors.has(s))) {
    return "Investor only covers sectors you excluded.";
  }

  const geo = norm([...company.geography, ...(company.headquarters ? [company.headquarters] : [])]);
  const invGeo = norm(inv.geoFocus);
  if (geo.size && invGeo.size && ![...invGeo].some((g) => GLOBAL.has(g)) && overlap(geo, invGeo).length === 0) {
    return `Invests in ${pretty(inv.geoFocus)} only.`;
  }

  if (company.askAmountUsd && inv.checkSizeMinUsd != null && inv.checkSizeMinUsd > company.askAmountUsd) {
    return `Minimum cheque ($${inv.checkSizeMinUsd.toLocaleString("en-US")}) is larger than your whole round.`;
  }
  return null;
}

function scoreComponents(company: CompanyProfile, inv: InvestorProfile, weights: MatchWeights): Record<MatchComponent, ComponentResult> {
  const c = {} as Record<MatchComponent, ComponentResult>;
  const set = (k: MatchComponent, score: number | null, evidence: string | null) => (c[k] = { score, weight: weights[k], evidence });

  // Sector / sub-sector
  const cs = norm(company.sector);
  const csub = norm(company.subIndustries);
  const is = norm(inv.sectorFocus);
  const isub = norm(inv.subSectors);
  if ((cs.size || csub.size) && (is.size || isub.size)) {
    const all = new Set([...is, ...isub]);
    const sectorHits = overlap(cs, all);
    const subHits = overlap(csub, all);
    // Share of the company's sectors the investor covers; a sub-industry hit adds a bonus.
    let s = cs.size ? sectorHits.length / cs.size : 0;
    if (subHits.length) s = cs.size ? Math.min(1, s + 0.25) : 1;
    set("sector", s, sectorHits.length || subHits.length ? `Invests in ${pretty([...new Set([...sectorHits, ...subHits])])}` : null);
  } else set("sector", null, null);

  // Stage
  if (company.stage && inv.stageFocus.length) {
    const d = stageDistance(company.stage, inv.stageFocus);
    set("stage", d === 0 ? 1 : d === 1 ? 0.5 : 0, d === 0 ? `Invests at ${stageLabel(company.stage)}` : `Invests adjacent to ${stageLabel(company.stage)} (${inv.stageFocus.map(stageLabel).join(", ")})`);
  } else set("stage", null, null);

  // Check size: the founder's preferred cheque range, else "any cheque up to the round".
  const min = inv.checkSizeMinUsd;
  const max = inv.checkSizeMaxUsd;
  const wantMin = company.preferredCheck?.min ?? null;
  const wantMax = company.preferredCheck?.max ?? company.askAmountUsd ?? null;
  if ((min != null || max != null) && (wantMax != null || wantMin != null)) {
    const lo = min ?? 0;
    const hi = max ?? Number.MAX_SAFE_INTEGER;
    const wLo = wantMin ?? 0;
    const wHi = wantMax ?? Number.MAX_SAFE_INTEGER;
    const overlaps = lo <= wHi && hi >= wLo;
    const range = `$${(min ?? 0).toLocaleString("en-US")}–${max != null ? `$${max.toLocaleString("en-US")}` : "open"}`;
    set("checkSize", overlaps ? 1 : hi < wLo && hi >= wLo * 0.5 ? 0.4 : 0, overlaps ? `Typical cheque ${range} fits` : `Typical cheque ${range}`);
  } else set("checkSize", null, null);

  // Thesis
  const terms = norm([...(company.thesisTerms ?? []), ...company.extractedKeywords]);
  const thesis = norm(inv.thesisKeywords);
  if (terms.size && thesis.size) {
    const hits = overlap(terms, thesis);
    set("thesis", Math.min(1, hits.length / Math.min(terms.size, thesis.size)), hits.length ? `Thesis mentions ${pretty(hits)}` : null);
  } else set("thesis", null, null);

  // Business model
  const bm = norm(company.businessTypes);
  const ibm = norm(inv.businessModels);
  if (bm.size && ibm.size) {
    const hits = overlap(bm, ibm);
    set("businessModel", hits.length ? 1 : 0, hits.length ? `Backs ${pretty(hits)} businesses` : null);
  } else set("businessModel", null, null);

  // Geography
  const geo = norm([...company.geography, ...(company.headquarters ? [company.headquarters] : [])]);
  const ig = norm(inv.geoFocus);
  if (geo.size && ig.size) {
    const hits = overlap(geo, ig);
    set("geography", hits.length ? 1 : [...ig].some((g) => GLOBAL.has(g)) ? 0.7 : 0, hits.length ? `Invests in ${pretty(hits)}` : "Invests globally");
  } else set("geography", null, null);

  // Founder preferences (the investor's stated founder profile vs the team's signals)
  const fp = norm(inv.founderPreferences);
  const signals = norm(company.founderSignals);
  if (fp.size && signals.size) {
    const hits = overlap(fp, signals);
    set("founderMarketFit", hits.length / fp.size, hits.length ? `Looks for ${pretty(hits)} founders` : null);
  } else set("founderMarketFit", null, null);

  // Traction requirement / mandate
  if (inv.tractionRequirement && company.hasRevenue != null) {
    const ok = inv.tractionRequirement === "PRE_REVENUE_OK" || company.hasRevenue;
    set("tractionMandate", ok ? 1 : 0, ok ? (inv.tractionRequirement === "PRE_REVENUE_OK" ? "Backs pre-revenue companies" : "Revenue requirement met") : null);
  } else set("tractionMandate", null, null);

  return c;
}

const RECENCY_STALE_DAYS = 270;

export function scoreInvestor(
  company: CompanyProfile,
  investor: InvestorProfile,
  warmth: WarmthRecord | null,
  now: Date = new Date(),
  weights: MatchWeights = DEFAULT_WEIGHTS
): MatchResult {
  const components = scoreComponents(company, investor, weights);
  const failure = eligibilityFailure(company, investor, warmth);
  if (failure) {
    return { investorId: investor.id, score: 0, coverage: 0, components, reasons: [], mismatches: [failure], missing: [], excluded: true, exclusionReason: failure };
  }

  let earned = 0;
  let available = 0;
  const reasons: string[] = [];
  const missing: string[] = [];
  for (const k of MATCH_COMPONENTS) {
    const r = components[k];
    if (r.score === null) {
      if (r.weight > 0) missing.push(`${COMPONENT_LABELS[k]}: not enough data to compare`);
      continue;
    }
    earned += r.weight * r.score;
    available += r.weight;
    if (r.score > 0 && r.evidence) reasons.push(r.evidence);
  }
  const total = MATCH_COMPONENTS.reduce((s, k) => s + weights[k], 0) || 1;

  const mismatches: string[] = [];
  if (components.checkSize.score === 0) mismatches.push(`${components.checkSize.evidence ?? "Cheque size"} — outside your preferred range`);
  if (components.tractionMandate.score === 0) mismatches.push("Usually requires revenue before investing");
  if (components.businessModel.score === 0) mismatches.push(`Typically backs ${pretty(investor.businessModels ?? [])} models`);
  if (company.leadPreference === "LEAD" && investor.leadsRounds === false) mismatches.push("Usually follows rather than leads rounds");
  if (company.preferredInvestorTypes?.length && investor.investorType && !company.preferredInvestorTypes.includes(investor.investorType)) {
    mismatches.push(`Investor type (${investor.investorType.replace(/_/g, " ").toLowerCase()}) isn't one you prefer`);
  }
  if (investor.lastKnownActiveAt && (now.getTime() - investor.lastKnownActiveAt.getTime()) / 86_400_000 > RECENCY_STALE_DAYS) {
    mismatches.push("No known investment activity in the last 9 months");
  }
  if (warmth?.status === "REPLIED_INTERESTED") reasons.unshift("Previously replied with interest in a past campaign");
  else if (warmth?.status === "MEETING_BOOKED") reasons.unshift("Prior meeting booked with this investor");
  else if (warmth?.status === "REPLIED_NEEDS_INFO") reasons.unshift("Previously requested more information");

  return {
    investorId: investor.id,
    score: available > 0 ? Math.round((earned / available) * 1000) / 10 : 0,
    coverage: Math.round((available / total) * 100) / 100,
    components,
    reasons,
    mismatches,
    missing,
    excluded: false,
  };
}

/** A score below this means the evidence that exists mostly disagrees. */
const MIN_MEANINGFUL_SCORE = 25;

/** Real thesis fit is required: sector overlap AND a compatible stage. */
export function hasThesisFit(result: MatchResult): boolean {
  return (result.components.sector.score ?? 0) > 0 && (result.components.stage.score ?? 0) > 0;
}

export function rankInvestors(
  company: CompanyProfile,
  investors: InvestorProfile[],
  warmthMap: Map<string, WarmthRecord>,
  limit: number,
  now: Date = new Date(),
  weights: MatchWeights = DEFAULT_WEIGHTS
): MatchResult[] {
  return investors
    .map((inv) => scoreInvestor(company, inv, warmthMap.get(inv.id) ?? null, now, weights))
    .filter((r) => !r.excluded && hasThesisFit(r) && r.score >= MIN_MEANINGFUL_SCORE)
    .sort((a, b) => b.score - a.score || b.coverage - a.coverage)
    .slice(0, limit);
}
