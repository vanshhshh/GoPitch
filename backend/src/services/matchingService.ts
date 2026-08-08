/**
 * matchingService.ts
 *
 * Scores every investor in the database against a given company profile.
 * This is the product's actual moat: codifying the manual judgment Vansh applied
 * when reasoning about Rishen Kapoor's portfolio fit or Blume's thesis alignment,
 * so it runs automatically across the full investor base instead of one deal at a time.
 *
 * Scoring is deliberately transparent (no black-box ML) so founders can see WHY an
 * investor was matched — this builds trust and doubles as a debugging tool while
 * the investor database is still small and needs tuning.
 */

export type Stage = "IDEA" | "PRE_SEED" | "SEED" | "SERIES_A" | "SERIES_B_PLUS";

/**
 * Determines which keyword set to use for investor matching. LLM-generated decks
 * populate extractedKeywords with rich thesis-matching terms; founders who use the
 * upload fallback (no AI key configured) never get that field populated, since keyword
 * extraction is an LLM-only step. Rather than blocking matching entirely for that path,
 * this falls back to the founder's own explicitly-chosen sector tags — real
 * founder-provided data, not fabricated, just less granular than LLM extraction.
 */
export function resolveMatchingKeywords(extractedKeywords: string[], sector: string[]): string[] {
  if (extractedKeywords && extractedKeywords.length > 0) return extractedKeywords;
  return sector ?? [];
}

export type WarmthStatus =
  | "COLD"
  | "REPLIED_INTERESTED"
  | "REPLIED_PASS"
  | "REPLIED_NEEDS_INFO"
  | "MEETING_BOOKED";

export interface CompanyProfile {
  stage: Stage;
  sector: string[];
  geography: string[];
  askAmountUsd: number;
  extractedKeywords: string[];
}

export interface InvestorProfile {
  id: string;
  name: string;
  firm: string;
  stageFocus: Stage[];
  sectorFocus: string[];
  geoFocus: string[];
  checkSizeMinUsd: number | null;
  checkSizeMaxUsd: number | null;
  thesisKeywords: string[];
  lastKnownActiveAt: Date | null;
  isVerified: boolean;
}

export interface WarmthRecord {
  investorId: string;
  status: WarmthStatus;
}

export interface MatchResult {
  investorId: string;
  score: number; // 0-100
  breakdown: {
    stageFit: number;
    sectorFit: number;
    geoFit: number;
    checkSizeFit: number;
    recencyFit: number;
    warmthBonus: number;
  };
  reasons: string[]; // human-readable, shown to the founder in the UI
  excluded: boolean;
  exclusionReason?: string;
}

// Stage adjacency: an investor one stage off is still plausible (e.g. seed fund
// occasionally does pre-seed), two stages off basically never is.
const STAGE_ORDER: Stage[] = ["IDEA", "PRE_SEED", "SEED", "SERIES_A", "SERIES_B_PLUS"];

function stageDistance(a: Stage, b: Stage): number {
  return Math.abs(STAGE_ORDER.indexOf(a) - STAGE_ORDER.indexOf(b));
}

function normalizeMatchTerm(input: string): string {
  const value = input.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
  const aliases: Record<string, string> = {
    ai: "artificial intelligence",
    "ai ml": "artificial intelligence",
    ml: "artificial intelligence",
    saas: "software as a service",
    "b2b saas": "software as a service",
    enterprise: "enterprise software",
    "enterprise saas": "enterprise software",
    usa: "united states",
    us: "united states",
    sea: "southeast asia",
    uae: "united arab emirates",
  };
  return aliases[value] ?? value;
}

function jaccardOverlap(a: string[], b: string[]): number {
  const normA = new Set(a.map(normalizeMatchTerm));
  const normB = new Set(b.map(normalizeMatchTerm));
  if (normA.size === 0 || normB.size === 0) return 0;
  let intersection = 0;
  for (const item of normA) if (normB.has(item)) intersection++;
  const union = new Set([...normA, ...normB]).size;
  return intersection / union;
}

const WEIGHTS = {
  stageFit: 25,
  sectorFit: 30,
  geoFit: 10,
  checkSizeFit: 15,
  recencyFit: 5,
  warmthBonus: 15, // additive on top, can push a mediocre thesis-fit investor to the top of the list
};

const RECENCY_STALE_DAYS = 270; // ~9 months with no known activity -> contact likely dead/inactive

export function scoreInvestor(
  company: CompanyProfile,
  investor: InvestorProfile,
  warmth: WarmthRecord | null,
  now: Date = new Date()
): MatchResult {
  const reasons: string[] = [];

  // Hard exclusion: previously passed, don't waste the founder's one shot with this investor
  // by re-pitching before enough time/traction has changed. This is a deliberate product
  // decision, not just a scoring penalty — re-spamming a "pass" burns reputation fast.
  if (warmth?.status === "REPLIED_PASS") {
    return {
      investorId: investor.id,
      score: 0,
      breakdown: { stageFit: 0, sectorFit: 0, geoFit: 0, checkSizeFit: 0, recencyFit: 0, warmthBonus: 0 },
      reasons: [],
      excluded: true,
      exclusionReason: "Investor already passed on this founder in a prior campaign.",
    };
  }

  if (!investor.isVerified) {
    return {
      investorId: investor.id,
      score: 0,
      breakdown: { stageFit: 0, sectorFit: 0, geoFit: 0, checkSizeFit: 0, recencyFit: 0, warmthBonus: 0 },
      reasons: [],
      excluded: true,
      exclusionReason: "Email not yet verified — excluded to protect sender deliverability.",
    };
  }

  // --- Stage fit ---
  const minDistance = Math.min(...investor.stageFocus.map((s) => stageDistance(company.stage, s)));
  const stageFit =
    minDistance === 0 ? WEIGHTS.stageFit : minDistance === 1 ? WEIGHTS.stageFit * 0.5 : 0;
  if (stageFit > 0) {
    reasons.push(
      minDistance === 0
        ? `Invests directly at ${company.stage.replace("_", " ").toLowerCase()} stage`
        : `Occasionally invests adjacent to ${company.stage.replace("_", " ").toLowerCase()} stage`
    );
  }

  // --- Sector fit (thesis keyword overlap, Jaccard on combined sector tags + free-text thesis) ---
  const sectorOverlap = jaccardOverlap(company.sector, investor.sectorFocus);
  const keywordOverlap = jaccardOverlap(company.extractedKeywords, investor.thesisKeywords);
  const combinedSectorSignal = Math.max(sectorOverlap, keywordOverlap * 0.8); // sector tag match trusted more than loose keyword match
  const sectorFit = combinedSectorSignal * WEIGHTS.sectorFit;
  if (sectorOverlap > 0.2) {
    const overlapping = company.sector.filter((s) =>
      investor.sectorFocus.map(normalizeMatchTerm).includes(normalizeMatchTerm(s))
    );
    reasons.push(`Sector thesis overlap: ${overlapping.join(", ")}`);
  }

  // --- Geography fit ---
  const geoOverlap = jaccardOverlap(company.geography, investor.geoFocus);
  const geoFit = geoOverlap * WEIGHTS.geoFit;
  if (geoOverlap > 0) reasons.push("Geography aligns with fund's investment focus");

  // --- Check size fit ---
  let checkSizeFit = 0;
  if (investor.checkSizeMinUsd != null && investor.checkSizeMaxUsd != null) {
    const { checkSizeMinUsd: min, checkSizeMaxUsd: max } = investor;
    if (company.askAmountUsd >= min && company.askAmountUsd <= max) {
      checkSizeFit = WEIGHTS.checkSizeFit;
      reasons.push(`Ask amount fits fund's typical check size ($${min.toLocaleString()}-$${max.toLocaleString()})`);
    } else {
      // Partial credit if within 30% of the nearest bound — funds flex for strong deals
      const nearestBound = company.askAmountUsd < min ? min : max;
      const distanceRatio = Math.abs(company.askAmountUsd - nearestBound) / nearestBound;
      if (distanceRatio <= 0.3) checkSizeFit = WEIGHTS.checkSizeFit * 0.4;
    }
  } else {
    checkSizeFit = WEIGHTS.checkSizeFit * 0.3; // unknown check size — neutral partial credit, don't over-penalize
  }

  // --- Recency fit (is this contact still plausibly live/active) ---
  let recencyFit = WEIGHTS.recencyFit * 0.5; // default neutral if unknown
  if (investor.lastKnownActiveAt) {
    const daysSinceActive = (now.getTime() - investor.lastKnownActiveAt.getTime()) / 86_400_000;
    recencyFit = daysSinceActive <= RECENCY_STALE_DAYS ? WEIGHTS.recencyFit : WEIGHTS.recencyFit * 0.2;
  }

  // --- Warmth bonus (relationship signal overrides cold scoring) ---
  let warmthBonus = 0;
  if (warmth?.status === "REPLIED_INTERESTED") {
    warmthBonus = WEIGHTS.warmthBonus;
    reasons.unshift("Previously replied with interest in a past campaign");
  } else if (warmth?.status === "MEETING_BOOKED") {
    warmthBonus = WEIGHTS.warmthBonus * 1.2;
    reasons.unshift("Prior meeting booked with this investor");
  } else if (warmth?.status === "REPLIED_NEEDS_INFO") {
    warmthBonus = WEIGHTS.warmthBonus * 0.6;
    reasons.unshift("Previously requested more information");
  }

  const rawScore = stageFit + sectorFit + geoFit + checkSizeFit + recencyFit + warmthBonus;
  const score = Math.min(100, Math.round(rawScore * 10) / 10);

  return {
    investorId: investor.id,
    score,
    breakdown: {
      stageFit: round1(stageFit),
      sectorFit: round1(sectorFit),
      geoFit: round1(geoFit),
      checkSizeFit: round1(checkSizeFit),
      recencyFit: round1(recencyFit),
      warmthBonus: round1(warmthBonus),
    },
    reasons,
    excluded: false,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Scores and ranks the full investor list for a company, returning the top N.
 * This is what powers "curated list of 30" vs the paid "expand targeting" add-on.
 */
// A score below this floor means the only signal present is something like "recency" or
// a small partial check-size credit, with zero actual stage/sector/geo fit. Showing that
// to a founder as a "match" would be misleading, so it's excluded from ranked output even
// though it's technically non-zero.
const MIN_MEANINGFUL_SCORE = 10;

export function rankInvestors(
  company: CompanyProfile,
  investors: InvestorProfile[],
  warmthMap: Map<string, WarmthRecord>,
  limit: number,
  now: Date = new Date()
): MatchResult[] {
  const scored = investors
    .map((inv) => scoreInvestor(company, inv, warmthMap.get(inv.id) ?? null, now))
    .filter((r) => !r.excluded && r.score >= MIN_MEANINGFUL_SCORE)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit);
}
