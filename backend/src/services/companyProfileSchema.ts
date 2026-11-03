/**
 * companyProfileSchema.ts
 *
 * Single definition of the company profile: validation for every section, the
 * conditional traction questions (which depend on business type, industry and product
 * stage), and the completeness rules that decide when onboarding can finish. The
 * frontend renders onboarding and "My Company" from GET /api/company-profile/questions,
 * so a question is defined here exactly once.
 */
import { z } from "zod";

export const FUNDING_STAGES = ["IDEA", "PRE_SEED", "SEED", "SERIES_A", "SERIES_B_PLUS"] as const;
export const PRODUCT_STAGES = ["IDEA", "PROTOTYPE", "MVP", "LAUNCHED", "SCALING"] as const;
export const BUSINESS_TYPES = ["B2B", "B2C", "B2B2C", "MARKETPLACE", "SAAS", "D2C", "DEEPTECH", "HARDWARE", "SERVICES", "OTHER"] as const;
export const INSTRUMENTS = ["EQUITY", "SAFE", "CONVERTIBLE_NOTE", "CCPS", "CCD", "IFRS_SAFE", "DEBT", "OTHER"] as const;
export const INVESTOR_TYPES = ["VC", "MICRO_VC", "ANGEL", "ANGEL_NETWORK", "CVC", "ACCELERATOR", "FAMILY_OFFICE", "SYNDICATE", "OTHER"] as const;
export const SKILLS = ["TECHNICAL", "PRODUCT", "SALES", "OPERATIONS", "MARKETING", "FINANCE", "DESIGN", "RESEARCH"] as const;

const text = (max: number) => z.string().trim().max(max);
// Optional fields accept "", null or absent as "empty" (records round-trip from the API with nulls).
const optText = (max: number) => z.union([text(max), z.null()]).optional().transform((v) => (v ? v : undefined));
const url = z
  .union([
    z.null(),
    z
      .string()
      .trim()
      .max(500)
      .refine((v) => v === "" || /^https?:\/\/[^\s]+\.[^\s]+/i.test(v), "Enter a full URL starting with http:// or https://"),
  ])
  .optional()
  .transform((v) => (v ? v : undefined));
const linkedin = url.refine((v) => !v || /linkedin\.com\//i.test(v), "Enter a LinkedIn profile URL (linkedin.com/in/…)");
const tags = (max = 20, len = 80) => z.array(text(len).min(1)).max(max).transform((t) => [...new Set(t)]);
const optionalTags = (max = 20, len = 80) => z.array(text(len).min(1)).max(max).default([]).transform((t) => [...new Set(t)]);
const money = z.number().finite().min(0).max(1e12);
const pct = z.number().finite().min(-1000).max(1000);
const year = new Date().getFullYear();

// ---------- Founders ----------
export const founderSchema = z.object({
  fullName: text(120).min(1, "Founder name is required."),
  role: optText(80),
  linkedinUrl: linkedin,
  location: optText(120),
  education: optText(1000),
  experience: optText(3000),
  previousCompanies: optText(2000),
  domainExpertise: optionalTags(15),
  skills: z.array(z.enum(SKILLS)).max(SKILLS.length).default([]),
  previousFounder: z.boolean().nullable().optional(),
  motivation: optText(2000),
  uniqueInsight: optText(2000),
  commitment: z.enum(["FULL_TIME", "PART_TIME"]).nullable().optional(),
});
export type FounderInput = z.infer<typeof founderSchema>;

// ---------- Step 2: company overview (typed columns) ----------
export const overviewSchema = z.object({
  name: text(120).min(1, "Company name is required."),
  website: url,
  foundedYear: z.number().int().min(1900).max(year).nullable().optional(),
  headquarters: optText(120),
  sector: tags(10, 60),
  subIndustry: tags(10, 60),
  businessType: z.array(z.enum(BUSINESS_TYPES)).max(4),
  oneLiner: optText(200),
  description: optText(4000),
  problem: optText(4000),
  targetCustomer: optText(1000),
  existingAlternatives: optText(2000),
  solution: optText(4000),
  competitiveAdvantage: optText(2000),
  competitors: tags(15, 120),
});

// ---------- Step 3: product & market ----------
export const productMarketSchema = z.object({
  productStage: z.enum(PRODUCT_STAGES).nullable().optional(),
  productUrl: url,
  productDescription: optText(3000),
  customerProfile: optText(2000),
  tamUsd: money.nullable().optional(),
  samUsd: money.nullable().optional(),
  somUsd: money.nullable().optional(),
  marketSizeSource: optText(500),
  targetGeographies: tags(15, 60),
  businessModel: optText(1000),
  pricingModel: optText(1000),
  distributionStrategy: optText(2000),
  technologyDifferentiation: optText(2000),
  replicationBarriers: optText(2000),
});

// ---------- Step 4: traction (conditional metrics) ----------
export interface MetricQuestion {
  key: string;
  label: string;
  help?: string;
  kind: "currency" | "percent" | "number" | "text";
  sensitive?: boolean;
  /** Shown when ANY listed condition matches; no conditions = always shown. */
  when?: { businessTypes?: string[]; industries?: string[]; productStages?: string[]; revenueStages?: boolean };
}

const REVENUE_STAGES = ["LAUNCHED", "SCALING"];
const SAAS = ["SAAS", "B2B"];

export const TRACTION_QUESTIONS: MetricQuestion[] = [
  { key: "summary", label: "Traction summary", kind: "text", help: "In a sentence or two: the strongest proof that this is working." },
  // Validation — every company, emphasised pre-revenue.
  { key: "customerDiscovery", label: "Customer discovery so far", kind: "text", help: "Interviews, surveys, pilots — what did you learn?", when: { productStages: ["IDEA", "PROTOTYPE", "MVP"] } },
  { key: "waitlist", label: "Waitlist sign-ups", kind: "number", when: { productStages: ["IDEA", "PROTOTYPE", "MVP"] } },
  { key: "pilotsAndLois", label: "Pilots, LOIs or design partners", kind: "text", help: "Names only if you're comfortable sharing them." },
  { key: "activeUsers", label: "Monthly active users", kind: "number", when: { productStages: ["MVP", "LAUNCHED", "SCALING"] } },
  { key: "payingCustomers", label: "Paying customers", kind: "number", when: { revenueStages: true } },
  { key: "monthlyRevenueUsd", label: "Monthly revenue (USD)", kind: "currency", sensitive: true, when: { revenueStages: true } },
  { key: "revenueGrowthPct", label: "Month-on-month revenue growth (%)", kind: "percent", help: "Average over the last 3 months.", sensitive: true, when: { revenueStages: true } },
  { key: "grossMarginPct", label: "Gross margin (%)", kind: "percent", sensitive: true, when: { revenueStages: true } },
  { key: "majorCustomers", label: "Major customers and partnerships", kind: "text", when: { productStages: ["MVP", "LAUNCHED", "SCALING"] } },
  // SaaS / B2B
  { key: "mrrUsd", label: "MRR (USD)", kind: "currency", help: "Monthly recurring revenue — subscriptions only, not one-off fees.", sensitive: true, when: { businessTypes: SAAS } },
  { key: "arrUsd", label: "ARR (USD)", kind: "currency", help: "Usually 12 × MRR.", sensitive: true, when: { businessTypes: SAAS } },
  { key: "monthlyChurnPct", label: "Monthly churn (%)", kind: "percent", help: "Share of customers (or revenue) lost per month.", when: { businessTypes: SAAS } },
  { key: "netRetentionPct", label: "Net revenue retention (%)", kind: "percent", help: "Revenue from last year's customers today ÷ their revenue then.", when: { businessTypes: SAAS } },
  { key: "cacUsd", label: "Customer acquisition cost (USD)", kind: "currency", help: "Sales + marketing spend ÷ new customers.", when: { businessTypes: [...SAAS, "B2C", "D2C"] } },
  // Marketplace
  { key: "gmvMonthlyUsd", label: "Monthly GMV (USD)", kind: "currency", help: "Total value transacted through the platform.", sensitive: true, when: { businessTypes: ["MARKETPLACE"] } },
  { key: "takeRatePct", label: "Take rate (%)", kind: "percent", when: { businessTypes: ["MARKETPLACE"] } },
  { key: "monthlyTransactions", label: "Monthly transactions", kind: "number", when: { businessTypes: ["MARKETPLACE"] } },
  { key: "liquidity", label: "Liquidity", kind: "text", help: "e.g. % of listings that transact within 30 days.", when: { businessTypes: ["MARKETPLACE"] } },
  // D2C
  { key: "repeatPurchasePct", label: "Repeat purchase rate (%)", kind: "percent", when: { businessTypes: ["D2C", "B2C"] } },
  { key: "distributionChannels", label: "Sales channels", kind: "text", help: "Own site, marketplaces, retail…", when: { businessTypes: ["D2C"] } },
  // Deeptech / hardware
  { key: "technologyReadiness", label: "Technology readiness", kind: "text", help: "TRL level or plain description of what's proven.", when: { businessTypes: ["DEEPTECH", "HARDWARE"] } },
  { key: "ipStatus", label: "Patents / IP", kind: "text", when: { businessTypes: ["DEEPTECH", "HARDWARE"] } },
  { key: "rdValidation", label: "R&D validation", kind: "text", help: "Lab results, grants, technical partners.", when: { businessTypes: ["DEEPTECH", "HARDWARE"] } },
  // AI
  { key: "proprietaryData", label: "Proprietary data advantage", kind: "text", when: { industries: ["ai", "ai/ml", "artificial intelligence", "machine learning"] } },
  { key: "modelDifferentiation", label: "Model differentiation", kind: "text", help: "Own models, fine-tuning, or orchestration — and why it's hard to copy.", when: { industries: ["ai", "ai/ml", "artificial intelligence", "machine learning"] } },
  { key: "aiUsage", label: "Deployment and usage", kind: "text", when: { industries: ["ai", "ai/ml", "artificial intelligence", "machine learning"] } },
  // Fintech
  { key: "regulatoryStatus", label: "Regulatory status and licences", kind: "text", help: "e.g. RBI PA licence applied, NBFC partner.", when: { industries: ["fintech", "payments", "lending", "insurtech"] } },
  { key: "transactionVolumeUsd", label: "Monthly transaction volume (USD)", kind: "currency", sensitive: true, when: { industries: ["fintech", "payments", "lending"] } },
  // Finance — always optional and sensitive
  { key: "acquisitionChannels", label: "Main customer acquisition channels", kind: "text" },
  { key: "previousFundingUsd", label: "Funding raised to date (USD)", kind: "currency", sensitive: true },
  { key: "monthlyBurnUsd", label: "Monthly burn (USD)", kind: "currency", help: "Net cash spent per month.", sensitive: true },
  { key: "runwayMonths", label: "Runway (months)", kind: "number", sensitive: true },
];

export function applicableTractionQuestions(ctx: { businessTypes: string[]; industries: string[]; productStage?: string | null }): MetricQuestion[] {
  const industries = ctx.industries.map((i) => i.toLowerCase());
  return TRACTION_QUESTIONS.filter((q) => {
    if (!q.when) return true;
    const w = q.when;
    if (w.businessTypes?.some((b) => ctx.businessTypes.includes(b))) return true;
    if (w.industries?.some((i) => industries.includes(i))) return true;
    if (w.productStages && ctx.productStage && w.productStages.includes(ctx.productStage)) return true;
    if (w.revenueStages && ctx.productStage && REVENUE_STAGES.includes(ctx.productStage)) return true;
    return false;
  });
}

const tractionValue = z.union([z.number().finite().min(-1e12).max(1e12), text(2000)]).nullable();
export const tractionSchema = z
  .record(z.string(), tractionValue)
  .refine((r) => Object.keys(r).every((k) => TRACTION_QUESTIONS.some((q) => q.key === k)), "Unknown traction metric.")
  .refine(
    (r) =>
      Object.entries(r).every(([k, v]) => {
        if (v === null || v === "") return true;
        const q = TRACTION_QUESTIONS.find((x) => x.key === k);
        if (!q) return true; // reported by the unknown-metric check
        return q.kind === "text" ? typeof v === "string" : typeof v === "number" && (q.kind === "percent" || v >= 0);
      }),
    "A metric has the wrong type (numbers for amounts and percentages, text for descriptions)."
  );

// ---------- Step 5: fundraising ----------
export const fundraisingSchema = z
  .object({
    stage: z.enum(FUNDING_STAGES).nullable().optional(),
    targetAmountUsd: money.nullable().optional(),
    committedAmountUsd: money.nullable().optional(),
    previouslyRaisedUsd: money.nullable().optional(),
    valuationUsd: money.nullable().optional(),
    instrument: z.enum(INSTRUMENTS).nullable().optional(),
    closeTimeline: optText(120),
    useOfFunds: z
      .array(z.object({ category: text(80).min(1), percent: z.number().min(0).max(100) }))
      .max(10)
      .optional()
      .refine((u) => !u || u.length === 0 || Math.round(u.reduce((s, x) => s + x.percent, 0)) === 100, "Use of funds percentages must add up to 100."),
    milestones: optText(2000),
    existingInvestors: optText(1000),
    leadInvestor: optText(200),
  })
  .refine((f) => f.committedAmountUsd == null || f.targetAmountUsd == null || f.committedAmountUsd <= f.targetAmountUsd, {
    message: "Committed amount can't exceed the target raise.",
    path: ["committedAmountUsd"],
  });

// ---------- Step 6: investor preferences (wishes, not eligibility) ----------
export const preferencesSchema = z
  .object({
    stages: z.array(z.enum(FUNDING_STAGES)).max(5).optional(),
    investorTypes: z.array(z.enum(INVESTOR_TYPES)).max(INVESTOR_TYPES.length).optional(),
    sectors: tags(15, 60).optional(),
    geographies: tags(15, 60).optional(),
    minCheckUsd: money.nullable().optional(),
    maxCheckUsd: money.nullable().optional(),
    leadPreference: z.enum(["LEAD", "FOLLOW", "EITHER"]).nullable().optional(),
    strategicValue: optText(1000),
    previouslyContactedFunds: tags(100, 120).optional(),
    excludedInvestors: tags(100, 120).optional(),
    excludedSectors: tags(15, 60).optional(),
  })
  .refine((p) => p.minCheckUsd == null || p.maxCheckUsd == null || p.minCheckUsd <= p.maxCheckUsd, {
    message: "Minimum check size can't be larger than the maximum.",
    path: ["minCheckUsd"],
  });

// ---------- Step 7: documents (links; deck uses the existing decks table) ----------
export const documentsSchema = z.object({
  demoUrl: url,
  videoUrl: url,
  financialModelUrl: url,
});

export const SECTION_SCHEMAS = {
  overview: overviewSchema.partial(),
  productMarket: productMarketSchema.partial(),
  traction: tractionSchema,
  fundraising: fundraisingSchema,
  preferences: preferencesSchema,
  documents: documentsSchema.partial(),
} as const;
export type SectionName = keyof typeof SECTION_SCHEMAS;

// ---------- Completeness ----------
export interface CompletenessCheck {
  section: "founders" | "overview" | "productMarket" | "traction" | "fundraising" | "preferences" | "documents";
  field: string;
  label: string;
  required: boolean;
}

export const COMPLETENESS: CompletenessCheck[] = [
  { section: "founders", field: "founders", label: "At least one founder profile", required: true },
  { section: "founders", field: "founderBackground", label: "Founder experience or domain expertise", required: true },
  { section: "overview", field: "name", label: "Company name", required: true },
  { section: "overview", field: "oneLiner", label: "One-line description", required: true },
  { section: "overview", field: "problem", label: "Problem", required: true },
  { section: "overview", field: "solution", label: "Solution", required: true },
  { section: "overview", field: "sector", label: "Industry", required: true },
  { section: "overview", field: "businessType", label: "Business type", required: true },
  { section: "overview", field: "headquarters", label: "Headquarters", required: true },
  { section: "overview", field: "targetCustomer", label: "Target customer", required: false },
  { section: "overview", field: "competitiveAdvantage", label: "Competitive advantage", required: false },
  { section: "overview", field: "subIndustry", label: "Sub-industry", required: false },
  { section: "productMarket", field: "productStage", label: "Product stage", required: true },
  { section: "productMarket", field: "targetGeographies", label: "Target geography", required: true },
  { section: "productMarket", field: "businessModel", label: "Business model", required: false },
  { section: "productMarket", field: "productDescription", label: "Product description", required: false },
  { section: "traction", field: "traction", label: "At least one traction or validation signal", required: false },
  { section: "fundraising", field: "stage", label: "Funding stage", required: true },
  { section: "fundraising", field: "targetAmountUsd", label: "Target raise amount", required: true },
  { section: "fundraising", field: "useOfFunds", label: "Use of funds", required: false },
  { section: "preferences", field: "minCheckUsd", label: "Preferred check size", required: false },
  { section: "documents", field: "deck", label: "Pitch deck", required: false },
];

export interface ProfileForCompleteness {
  founders: { experience?: string | null; domainExpertise?: string[]; previousCompanies?: string | null }[];
  overview: Record<string, any>;
  productMarket: Record<string, any>;
  traction: Record<string, any>;
  fundraising: Record<string, any>;
  preferences: Record<string, any>;
  hasDeck: boolean;
}

function filled(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.values(v as object).some(filled);
  return true;
}

export function evaluateCompleteness(p: ProfileForCompleteness) {
  const value = (c: CompletenessCheck): unknown => {
    if (c.field === "founders") return p.founders.length;
    if (c.field === "founderBackground") return p.founders.some((f) => filled(f.experience) || filled(f.domainExpertise) || filled(f.previousCompanies));
    if (c.field === "deck") return p.hasDeck;
    if (c.section === "traction") return Object.values(p.traction).some(filled);
    return (p as any)[c.section]?.[c.field];
  };
  const missing = COMPLETENESS.filter((c) => {
    const v = value(c);
    return !(typeof v === "number" ? v > 0 : typeof v === "boolean" ? v : filled(v));
  });
  const done = COMPLETENESS.length - missing.length;
  return {
    percent: Math.round((done / COMPLETENESS.length) * 100),
    missingRequired: missing.filter((m) => m.required),
    missingOptional: missing.filter((m) => !m.required),
    canComplete: missing.every((m) => !m.required),
  };
}
