/**
 * companyIntelligence.ts
 *
 * Builds the structured company & founder intelligence profile shown at the end of
 * onboarding. Two layers:
 *  1. Deterministic checks (always run, no AI): missing information and internal
 *     inconsistencies in what the founder entered.
 *  2. An AI classification/summary, when a provider is available. Every field carries a
 *     `basis`: FOUNDER_PROVIDED (restates input), AI_CLASSIFICATION (a label such as
 *     industry or thesis category) or INFERRED (anything beyond the input). Founder
 *     edits become FOUNDER_CONFIRMED.
 *
 * Privacy: only founder-written profile text goes to the AI provider. Financial figures
 * are included only with the company's explicit ai_financials_consent; uploaded
 * documents and Gmail data are never sent.
 */
import { createHash } from "crypto";
import { pool, Queryable } from "../lib/db";
import { AIProviderUnavailableError, completeStructured, isAIFeatureAvailable } from "../lib/llmService";
import { TRACTION_QUESTIONS } from "./companyProfileSchema";
import { loadProfile, ProfileError } from "./companyProfileService";

export type Basis = "FOUNDER_PROVIDED" | "AI_CLASSIFICATION" | "INFERRED" | "FOUNDER_CONFIRMED";
export interface IntelField {
  value: string;
  basis: Basis;
  warning?: string;
}

export const INTEL_TEXT_FIELDS = [
  "positioning",
  "problem",
  "solution",
  "industry",
  "subIndustry",
  "businessModel",
  "productMaturity",
  "targetMarket",
  "differentiation",
  "founderExpertise",
  "founderMarketFit",
  "tractionSummary",
  "fundraisingSummary",
] as const;
export type IntelTextField = (typeof INTEL_TEXT_FIELDS)[number];

export interface IntelligenceProfile {
  fields: Partial<Record<IntelTextField, IntelField>>;
  thesisCategories: { value: string; basis: Basis }[];
  missingInformation: string[];
  inconsistencies: string[];
  aiUsed: boolean;
  aiNote?: string;
}

type Profile = Awaited<ReturnType<typeof loadProfile>>;

// ---------- deterministic checks ----------
export function findInconsistencies(p: Profile): string[] {
  const issues: string[] = [];
  const t = p.traction as Record<string, any>;
  const f = p.fundraising as Record<string, any>;
  const pm = p.productMarket as Record<string, any>;
  const pref = p.preferences as Record<string, any>;
  const num = (v: unknown) => (typeof v === "number" ? v : null);

  const mrr = num(t.mrrUsd);
  const arr = num(t.arrUsd);
  if (mrr && arr && Math.abs(arr - mrr * 12) / (mrr * 12) > 0.25) issues.push(`ARR ($${arr.toLocaleString("en-US")}) isn't close to 12 × MRR ($${(mrr * 12).toLocaleString("en-US")}).`);
  const revenueKeys = ["mrrUsd", "arrUsd", "monthlyRevenueUsd", "gmvMonthlyUsd"];
  if (pm.productStage && ["IDEA", "PROTOTYPE"].includes(pm.productStage) && revenueKeys.some((k) => num(t[k]))) {
    issues.push(`Product stage is ${pm.productStage.toLowerCase()} but revenue figures were entered.`);
  }
  if (f.stage && ["SERIES_A", "SERIES_B_PLUS"].includes(f.stage) && pm.productStage && ["IDEA", "PROTOTYPE"].includes(pm.productStage)) {
    issues.push(`Raising a ${f.stage.replace(/_/g, " ").toLowerCase()} round with a product at ${pm.productStage.toLowerCase()} stage is unusual — check the stage.`);
  }
  if (num(t.monthlyRevenueUsd) && num(t.payingCustomers) === 0) issues.push("Monthly revenue is entered but paying customers is 0.");
  const burn = num(t.monthlyBurnUsd);
  const runway = num(t.runwayMonths);
  if (burn && runway && runway > 120) issues.push("Runway over 10 years looks unlikely given the burn entered.");
  if (pref.minCheckUsd && f.targetAmountUsd && pref.minCheckUsd > f.targetAmountUsd) issues.push("Preferred minimum check size is larger than the whole round.");
  if (pref.stages?.length && f.stage && !pref.stages.includes(f.stage)) issues.push("Preferred investor stages don't include your current funding stage.");
  if (num(f.previouslyRaisedUsd) && num(t.previousFundingUsd) && f.previouslyRaisedUsd !== t.previousFundingUsd) {
    issues.push("Previously raised amount differs between Traction and Fundraising.");
  }
  if (p.founders.length > 0 && p.founders.every((x) => x.commitment === "PART_TIME")) issues.push("All founders are part-time; most institutional investors expect at least one full-time founder.");
  return issues;
}

export function findMissingInformation(p: Profile): string[] {
  const missing = [...p.completeness.missingRequired, ...p.completeness.missingOptional].map((m) => m.label);
  if (!p.founders.some((f) => f.linkedinUrl)) missing.push("Founder LinkedIn profile");
  if (!(p.productMarket as any).tamUsd) missing.push("Market size (TAM) — optional, but investors ask");
  return [...new Set(missing)];
}

// ---------- AI input (privacy-filtered) ----------
export function buildAiInput(p: Profile, financialsConsent: boolean) {
  const sensitive = new Set(TRACTION_QUESTIONS.filter((q) => q.sensitive).map((q) => q.key));
  const traction = Object.fromEntries(
    Object.entries(p.traction).map(([k, v]) => [k, sensitive.has(k) && !financialsConsent ? "(provided, withheld from AI)" : v])
  );
  const f = p.fundraising as Record<string, any>;
  const fundraising = financialsConsent
    ? f
    : { stage: f.stage, targetAmountUsd: f.targetAmountUsd, instrument: f.instrument, useOfFunds: f.useOfFunds, milestones: f.milestones };
  return {
    company: p.overview,
    productMarket: p.productMarket,
    traction,
    fundraising,
    founders: p.founders.map(({ id: _id, isAccountHolder: _a, position: _p, linkedinUrl: _l, ...rest }) => rest),
  };
}

const SYSTEM = `You are a venture analyst preparing a structured profile of a startup for investor matching.
STRICT RULES:
- Use ONLY the facts in the input. Never invent customers, revenue, traction, credentials, market sizes, investors or numbers.
- If something isn't in the input, leave that field out rather than guessing.
- For each field set "basis": "FOUNDER_PROVIDED" if it restates input, "AI_CLASSIFICATION" for a category label (industry, sub-industry, business model, product maturity, thesis categories), "INFERRED" for any judgement beyond the input (e.g. founder-market fit).
- Keep each value under 60 words, plain text.
Respond only with JSON:
{"fields": {"positioning": {"value": string, "basis": string}, ... any of: problem, solution, industry, subIndustry, businessModel, productMaturity, targetMarket, differentiation, founderExpertise, founderMarketFit, tractionSummary, fundraisingSummary},
 "thesisCategories": [{"value": string, "basis": "AI_CLASSIFICATION"}],
 "missingInformation": [string], "inconsistencies": [string]}`;

const BASES: Basis[] = ["FOUNDER_PROVIDED", "AI_CLASSIFICATION", "INFERRED"];

/**
 * Validates model output and guards against fabrication: any number (≥2 digits) in a
 * field that doesn't appear in the founder's input downgrades that field to INFERRED
 * with a visible warning.
 */
export function parseIntelligence(raw: string, inputJson: string): Omit<IntelligenceProfile, "aiUsed"> {
  const parsed = JSON.parse(raw) as any;
  const inputNumbers = new Set((inputJson.match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/[,]/g, "")));
  const fields: IntelligenceProfile["fields"] = {};
  for (const key of INTEL_TEXT_FIELDS) {
    const f = parsed?.fields?.[key];
    if (!f || typeof f.value !== "string" || !f.value.trim()) continue;
    let basis: Basis = BASES.includes(f.basis) ? f.basis : "INFERRED";
    let warning: string | undefined;
    const numbers = (f.value.match(/\d[\d,.]*\d|\d{2,}/g) ?? []).map((n: string) => n.replace(/,/g, ""));
    if (numbers.some((n: string) => !inputNumbers.has(n))) {
      basis = "INFERRED";
      warning = "Contains a figure that isn't in your answers — check it.";
    }
    fields[key] = { value: f.value.trim().slice(0, 600), basis, ...(warning ? { warning } : {}) };
  }
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).map((x: string) => x.trim().slice(0, 300)).slice(0, 15) : []);
  return {
    fields,
    thesisCategories: (Array.isArray(parsed?.thesisCategories) ? parsed.thesisCategories : [])
      .map((c: any) => (typeof c === "string" ? c : c?.value))
      .filter((c: unknown): c is string => typeof c === "string" && !!c.trim())
      .slice(0, 8)
      .map((value: string) => ({ value: value.trim().slice(0, 60), basis: "AI_CLASSIFICATION" as Basis })),
    missingInformation: list(parsed?.missingInformation),
    inconsistencies: list(parsed?.inconsistencies),
  };
}

const BUSINESS_TYPE_LABELS: Record<string, string> = { SAAS: "SaaS", MARKETPLACE: "Marketplace", DEEPTECH: "Deeptech", HARDWARE: "Hardware", SERVICES: "Services", OTHER: "Other" };
const PRODUCT_STAGE_LABELS: Record<string, string> = { IDEA: "Idea", PROTOTYPE: "Prototype", MVP: "MVP", LAUNCHED: "Launched", SCALING: "Scaling" };

/** Founder-provided baseline used when no AI provider is available (and as a floor). */
export function founderOnlyProfile(p: Profile): IntelligenceProfile["fields"] {
  const o = p.overview as Record<string, any>;
  const pm = p.productMarket as Record<string, any>;
  const f = p.fundraising as Record<string, any>;
  const fp = (value?: string | null): IntelField | undefined => (value && value.trim() ? { value: value.trim(), basis: "FOUNDER_PROVIDED" } : undefined);
  const founders = p.founders
    .map((x) => [x.fullName, x.role, x.domainExpertise?.join(", ")].filter(Boolean).join(" — "))
    .filter(Boolean)
    .join("; ");
  const out: IntelligenceProfile["fields"] = {
    positioning: fp(o.oneLiner),
    problem: fp(o.problem),
    solution: fp(o.solution),
    industry: fp([...(o.sector ?? [])].join(", ")),
    subIndustry: fp([...(o.subIndustry ?? [])].join(", ")),
    businessModel: fp(pm.businessModel || [...(o.businessType ?? [])].map((b: string) => BUSINESS_TYPE_LABELS[b] ?? b).join(", ")),
    productMaturity: fp(pm.productStage ? PRODUCT_STAGE_LABELS[pm.productStage] ?? pm.productStage : null),
    targetMarket: fp(o.targetCustomer),
    differentiation: fp(o.competitiveAdvantage),
    founderExpertise: fp(founders),
    fundraisingSummary: fp(
      f.stage && f.targetAmountUsd ? `Raising $${Number(f.targetAmountUsd).toLocaleString("en-US")} (${String(f.stage).replace(/_/g, " ").toLowerCase()})` : null
    ),
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v)) as IntelligenceProfile["fields"];
}

export async function generateIntelligence(companyId: string, userId: string, db: Queryable = pool) {
  const profile = await loadProfile(companyId, userId, db);
  const input = buildAiInput(profile, profile.aiFinancialsConsent);
  const inputJson = JSON.stringify(input);
  const deterministic = { missing: findMissingInformation(profile), inconsistencies: findInconsistencies(profile) };

  let result: IntelligenceProfile = {
    fields: founderOnlyProfile(profile),
    thesisCategories: [],
    missingInformation: deterministic.missing,
    inconsistencies: deterministic.inconsistencies,
    aiUsed: false,
    aiNote: "AI classification isn't available right now; this summary uses only your own answers.",
  };
  let provider: string | null = null;

  if (isAIFeatureAvailable("profile")) {
    try {
      const ai = await completeStructured("profile", SYSTEM, inputJson, (text) => parseIntelligence(text, inputJson));
      provider = ai.provider;
      result = {
        // AI fields win only where present; founder-provided baseline fills the rest.
        fields: { ...result.fields, ...ai.value.fields },
        thesisCategories: ai.value.thesisCategories,
        missingInformation: [...new Set([...deterministic.missing, ...ai.value.missingInformation])],
        inconsistencies: [...new Set([...deterministic.inconsistencies, ...ai.value.inconsistencies])],
        aiUsed: true,
      };
    } catch (err) {
      if (!(err instanceof AIProviderUnavailableError)) throw err;
    }
  }

  const inputHash = createHash("sha256").update(inputJson).digest("hex");
  await db.query(
    `INSERT INTO company_ai_profiles (company_id, status, generated, edited, provider, input_hash, generated_at, confirmed_at, updated_at)
     VALUES ($1, 'DRAFT', $2, '{}', $3, $4, now(), NULL, now())
     ON CONFLICT (company_id) DO UPDATE SET status = 'DRAFT', generated = $2, edited = '{}', provider = $3, input_hash = $4,
       generated_at = now(), confirmed_at = NULL, updated_at = now()`,
    [companyId, result, provider, inputHash]
  );
  return getIntelligence(companyId, userId, db);
}

/** Effective profile = generated, overlaid with the founder's corrections. */
export function mergeIntelligence(generated: IntelligenceProfile, edited: any): IntelligenceProfile {
  const fields = { ...generated.fields };
  for (const [k, v] of Object.entries(edited?.fields ?? {})) {
    if (!INTEL_TEXT_FIELDS.includes(k as IntelTextField)) continue;
    if (typeof v === "string" && v.trim()) fields[k as IntelTextField] = { value: v.trim(), basis: "FOUNDER_CONFIRMED" };
    else if (v === null) delete fields[k as IntelTextField];
  }
  const thesis = Array.isArray(edited?.thesisCategories)
    ? edited.thesisCategories.map((value: string) => ({ value, basis: "FOUNDER_CONFIRMED" as Basis }))
    : generated.thesisCategories;
  return { ...generated, fields, thesisCategories: thesis };
}

export async function getIntelligence(companyId: string, userId: string, db: Queryable = pool) {
  const owned = (await db.query("SELECT id FROM companies WHERE id = $1 AND user_id = $2", [companyId, userId])).rows[0];
  if (!owned) throw new ProfileError(404, "Company not found.");
  const row = (await db.query("SELECT * FROM company_ai_profiles WHERE company_id = $1", [companyId])).rows[0];
  if (!row) return null;
  return {
    status: row.status as "DRAFT" | "CONFIRMED",
    provider: row.provider,
    generatedAt: row.generated_at,
    confirmedAt: row.confirmed_at,
    generated: row.generated as IntelligenceProfile,
    profile: mergeIntelligence(row.generated, row.edited),
  };
}

export async function saveIntelligenceEdits(
  companyId: string,
  userId: string,
  edits: { fields?: Record<string, string | null>; thesisCategories?: string[] },
  db: Queryable = pool
) {
  const current = await getIntelligence(companyId, userId, db);
  if (!current) throw new ProfileError(404, "Generate the profile summary first.");
  const fields: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(edits.fields ?? {})) {
    if (!INTEL_TEXT_FIELDS.includes(k as IntelTextField)) throw new ProfileError(400, `Unknown field ${k}.`);
    if (v !== null && (typeof v !== "string" || v.length > 1000)) throw new ProfileError(400, `Invalid value for ${k}.`);
    fields[k] = v;
  }
  const thesis = edits.thesisCategories?.map((t) => String(t).trim().slice(0, 60)).filter(Boolean).slice(0, 8);
  const row = (await db.query("SELECT edited FROM company_ai_profiles WHERE company_id = $1", [companyId])).rows[0];
  const merged = { fields: { ...(row.edited?.fields ?? {}), ...fields }, ...(thesis ? { thesisCategories: thesis } : row.edited?.thesisCategories ? { thesisCategories: row.edited.thesisCategories } : {}) };
  await db.query("UPDATE company_ai_profiles SET edited = $1, status = 'DRAFT', confirmed_at = NULL, updated_at = now() WHERE company_id = $2", [merged, companyId]);
  return getIntelligence(companyId, userId, db);
}

export async function confirmIntelligence(companyId: string, userId: string, db: Queryable = pool) {
  const current = await getIntelligence(companyId, userId, db);
  if (!current) throw new ProfileError(404, "Generate the profile summary first.");
  await db.query("UPDATE company_ai_profiles SET status = 'CONFIRMED', confirmed_at = now(), updated_at = now() WHERE company_id = $1", [companyId]);
  return getIntelligence(companyId, userId, db);
}

/** Thesis categories + classifications used by matching (confirmed or draft). */
export async function matchingSignals(companyId: string, db: Queryable = pool): Promise<{ thesis: string[]; subIndustry: string[] }> {
  const row = (await db.query("SELECT generated, edited FROM company_ai_profiles WHERE company_id = $1", [companyId])).rows[0];
  if (!row) return { thesis: [], subIndustry: [] };
  const merged = mergeIntelligence(row.generated, row.edited);
  return {
    thesis: merged.thesisCategories.map((t) => t.value),
    subIndustry: merged.fields.subIndustry ? merged.fields.subIndustry.value.split(/,\s*/).filter(Boolean) : [],
  };
}
