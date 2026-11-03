export interface Founder {
  id: string;
  isAccountHolder: boolean;
  fullName: string;
  role: string | null;
  linkedinUrl: string | null;
  location: string | null;
  education: string | null;
  experience: string | null;
  previousCompanies: string | null;
  domainExpertise: string[];
  skills: string[];
  previousFounder: boolean | null;
  motivation: string | null;
  uniqueInsight: string | null;
  commitment: "FULL_TIME" | "PART_TIME" | null;
}

export interface MissingItem {
  section: string;
  field: string;
  label: string;
  required: boolean;
}

export interface Profile {
  id: string;
  overview: Record<string, any>;
  productMarket: Record<string, any>;
  traction: Record<string, any>;
  fundraising: Record<string, any>;
  preferences: Record<string, any>;
  documents: Record<string, any>;
  founders: Founder[];
  deck: { id: string; source: string; version: number; fileName: string | null; fileType: string | null; createdAt: string } | null;
  aiFinancialsConsent: boolean;
  intelligence: { status: "DRAFT" | "CONFIRMED"; generatedAt: string; confirmedAt: string | null } | null;
  onboarding: { step: number; completedAt: string | null };
  completeness: { percent: number; missingRequired: MissingItem[]; missingOptional: MissingItem[]; canComplete: boolean };
}

export interface MetricQuestion {
  key: string;
  label: string;
  help?: string;
  kind: "currency" | "percent" | "number" | "text";
  sensitive?: boolean;
}

export type Basis = "FOUNDER_PROVIDED" | "AI_CLASSIFICATION" | "INFERRED" | "FOUNDER_CONFIRMED";
export interface Intelligence {
  status: "DRAFT" | "CONFIRMED";
  provider: string | null;
  generatedAt: string;
  confirmedAt: string | null;
  profile: {
    fields: Record<string, { value: string; basis: Basis; warning?: string }>;
    thesisCategories: { value: string; basis: Basis }[];
    missingInformation: string[];
    inconsistencies: string[];
    aiUsed: boolean;
    aiNote?: string;
  };
}

export const label = (map: Record<string, string>) => Object.entries(map).map(([value, l]) => ({ value, label: l }));

export const BUSINESS_TYPE_LABELS: Record<string, string> = {
  B2B: "B2B",
  B2C: "B2C",
  B2B2C: "B2B2C",
  MARKETPLACE: "Marketplace",
  SAAS: "SaaS",
  D2C: "D2C",
  DEEPTECH: "Deeptech",
  HARDWARE: "Hardware",
  SERVICES: "Services",
  OTHER: "Other",
};
export const FUNDING_STAGE_LABELS: Record<string, string> = { IDEA: "Idea", PRE_SEED: "Pre-seed", SEED: "Seed", SERIES_A: "Series A", SERIES_B_PLUS: "Series B+" };
export const PRODUCT_STAGE_LABELS: Record<string, string> = { IDEA: "Idea", PROTOTYPE: "Prototype", MVP: "MVP", LAUNCHED: "Launched", SCALING: "Scaling" };
export const INSTRUMENT_LABELS: Record<string, string> = {
  EQUITY: "Priced equity",
  SAFE: "SAFE",
  CONVERTIBLE_NOTE: "Convertible note",
  CCPS: "CCPS",
  CCD: "CCD",
  IFRS_SAFE: "iSAFE",
  DEBT: "Venture debt",
  OTHER: "Other",
};
export const INVESTOR_TYPE_LABELS: Record<string, string> = {
  VC: "VC fund",
  MICRO_VC: "Micro VC",
  ANGEL: "Angel",
  ANGEL_NETWORK: "Angel network",
  CVC: "Corporate VC",
  ACCELERATOR: "Accelerator",
  FAMILY_OFFICE: "Family office",
  SYNDICATE: "Syndicate",
  OTHER: "Other",
};
export const SKILL_LABELS: Record<string, string> = {
  TECHNICAL: "Technical",
  PRODUCT: "Product",
  SALES: "Sales",
  OPERATIONS: "Operations",
  MARKETING: "Marketing",
  FINANCE: "Finance",
  DESIGN: "Design",
  RESEARCH: "Research",
};
export const INDUSTRIES = ["Fintech", "SaaS", "AI", "Healthtech", "Climate", "Consumer", "Marketplace", "Edtech", "Deeptech", "D2C", "Logistics", "Agritech", "Gaming", "Media"];

export const INTEL_LABELS: Record<string, string> = {
  positioning: "Positioning",
  problem: "Problem",
  solution: "Solution",
  industry: "Industry",
  subIndustry: "Sub-industry",
  businessModel: "Business model",
  productMaturity: "Product maturity",
  targetMarket: "Target market",
  differentiation: "Competitive differentiation",
  founderExpertise: "Founder expertise",
  founderMarketFit: "Founder–market fit",
  tractionSummary: "Traction",
  fundraisingSummary: "Fundraising",
};
export const BASIS_LABELS: Record<Basis, { text: string; cls: string }> = {
  FOUNDER_PROVIDED: { text: "From your answers", cls: "bg-surface-muted text-ink-soft" },
  AI_CLASSIFICATION: { text: "AI classification", cls: "bg-teal-soft text-teal" },
  INFERRED: { text: "Inferred — check", cls: "bg-signal-soft text-signal" },
  FOUNDER_CONFIRMED: { text: "Edited by you", cls: "bg-verified-soft text-verified" },
};
