/**
 * Loads and saves the v2 company profile. Every function takes the caller's user id and
 * checks ownership, so a founder can only ever read or write their own company and its
 * founder records.
 */
import { pool, Queryable } from "../lib/db";
import { evaluateCompleteness, FounderInput, SECTION_SCHEMAS, SectionName } from "./companyProfileSchema";

export class ProfileError extends Error {
  constructor(readonly status: number, message: string, readonly details?: unknown) {
    super(message);
  }
}

/** The founder's active company: the requested one if they own it, else their most recent. */
export async function resolveCompanyId(userId: string, requested?: string | null, db: Queryable = pool): Promise<string | null> {
  if (requested) {
    const row = (await db.query("SELECT id FROM companies WHERE id = $1 AND user_id = $2", [requested, userId])).rows[0];
    if (!row) throw new ProfileError(404, "Company not found.");
    return row.id;
  }
  const row = (
    await db.query(
      "SELECT id FROM companies WHERE user_id = $1 ORDER BY (onboarding_completed_at IS NOT NULL) DESC, created_at DESC LIMIT 1",
      [userId]
    )
  ).rows[0];
  return row?.id ?? null;
}

async function ownedCompany(companyId: string, userId: string, db: Queryable = pool) {
  const row = (await db.query("SELECT * FROM companies WHERE id = $1 AND user_id = $2", [companyId, userId])).rows[0];
  if (!row) throw new ProfileError(404, "Company not found.");
  return row;
}

export function toFounder(r: any) {
  return {
    id: r.id,
    isAccountHolder: !!r.user_id,
    fullName: r.full_name,
    role: r.role,
    linkedinUrl: r.linkedin_url,
    location: r.location,
    education: r.education,
    experience: r.experience,
    previousCompanies: r.previous_companies,
    domainExpertise: r.domain_expertise ?? [],
    skills: r.skills ?? [],
    previousFounder: r.previous_founder,
    motivation: r.motivation,
    uniqueInsight: r.unique_insight,
    commitment: r.commitment,
    position: r.position,
  };
}

export function sectionsFromRow(c: any) {
  const productMarket = { ...(c.product_market ?? {}), productStage: c.product_stage ?? null };
  if (!productMarket.targetGeographies && c.geography?.length) productMarket.targetGeographies = c.geography;
  const fundraising = { ...(c.fundraising ?? {}) };
  if (fundraising.stage == null && c.stage) fundraising.stage = c.stage;
  if (fundraising.targetAmountUsd == null && c.ask_amount_usd != null) fundraising.targetAmountUsd = c.ask_amount_usd;
  return {
    overview: {
      name: c.name,
      website: c.website,
      foundedYear: c.founded_year,
      headquarters: c.headquarters,
      sector: c.sector ?? [],
      subIndustry: c.sub_industry ?? [],
      businessType: c.business_type ?? [],
      oneLiner: c.one_liner,
      description: c.description,
      problem: c.problem,
      targetCustomer: c.target_customer,
      existingAlternatives: c.existing_alternatives,
      solution: c.solution,
      competitiveAdvantage: c.competitive_advantage,
      competitors: c.competitors ?? [],
    },
    productMarket,
    // Metrics live in traction_metrics; the v1 free-text traction note is the "summary" answer.
    traction: { ...(c.traction_metrics ?? {}), ...(c.traction ? { summary: c.traction } : {}) },
    fundraising,
    preferences: c.investor_preferences ?? {},
    documents: c.documents ?? {},
  };
}

export async function loadProfile(companyId: string, userId: string, db: Queryable = pool) {
  const c = await ownedCompany(companyId, userId, db);
  const founders = (await db.query("SELECT * FROM company_founders WHERE company_id = $1 ORDER BY position, created_at", [companyId])).rows.map(toFounder);
  const deck = (await db.query("SELECT id, source, version, uploaded_file_name, uploaded_file_type, created_at FROM decks WHERE company_id = $1 ORDER BY version DESC LIMIT 1", [companyId])).rows[0];
  const ai = (await db.query("SELECT status, generated_at, confirmed_at FROM company_ai_profiles WHERE company_id = $1", [companyId])).rows[0];
  const sections = sectionsFromRow(c);
  const completeness = evaluateCompleteness({ founders, ...sections, hasDeck: !!deck });
  return {
    id: c.id,
    ...sections,
    founders,
    deck: deck
      ? { id: deck.id, source: deck.source, version: deck.version, fileName: deck.uploaded_file_name, fileType: deck.uploaded_file_type, createdAt: deck.created_at }
      : null,
    aiFinancialsConsent: c.ai_financials_consent,
    intelligence: ai ? { status: ai.status, generatedAt: ai.generated_at, confirmedAt: ai.confirmed_at } : null,
    onboarding: { step: c.onboarding_step, completedAt: c.onboarding_completed_at },
    completeness,
    updatedAt: c.updated_at,
  };
}

export async function createDraftCompany(userId: string, name: string, db: Queryable = pool) {
  const row = (await db.query("INSERT INTO companies (user_id, name, onboarding_step) VALUES ($1, $2, 0) RETURNING id", [userId, name.trim()])).rows[0];
  // The account holder is the first founder; their profile starts from the account name.
  const user = (await db.query("SELECT name, email FROM users WHERE id = $1", [userId])).rows[0];
  await db.query("INSERT INTO company_founders (company_id, user_id, full_name, position) VALUES ($1, $2, $3, 0)", [
    row.id,
    userId,
    user?.name || user?.email?.split("@")[0] || "Founder",
  ]);
  return row.id as string;
}

/**
 * Validates and saves one section. Typed columns are updated in place; JSON sections are
 * replaced with the validated payload (the client always sends the whole section).
 * Matching-critical values are mirrored into the legacy columns (stage, sector,
 * geography, ask_amount_usd) so every existing reader keeps working.
 */
export async function saveSection(companyId: string, userId: string, section: SectionName, raw: unknown, db: Queryable = pool) {
  const schema = SECTION_SCHEMAS[section];
  if (!schema) throw new ProfileError(400, "Unknown section.");
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ProfileError(400, issue?.message ?? "Invalid input.", { field: issue?.path.join(".") });
  }
  const data: any = parsed.data;
  const company = await ownedCompany(companyId, userId, db);

  if (section === "overview") {
    const map: Record<string, string> = {
      name: "name",
      website: "website",
      foundedYear: "founded_year",
      headquarters: "headquarters",
      sector: "sector",
      subIndustry: "sub_industry",
      businessType: "business_type",
      oneLiner: "one_liner",
      description: "description",
      problem: "problem",
      targetCustomer: "target_customer",
      existingAlternatives: "existing_alternatives",
      solution: "solution",
      competitiveAdvantage: "competitive_advantage",
      competitors: "competitors",
    };
    const sets: string[] = [];
    const params: any[] = [];
    for (const [key, column] of Object.entries(map)) {
      if (!(key in (raw as object))) continue;
      params.push(data[key] ?? null);
      sets.push(`${column} = $${params.length}`);
    }
    if (sets.length) {
      // Changing the industry invalidates keywords an older AI deck extracted.
      if ("sector" in (raw as object) && JSON.stringify([...(data.sector ?? [])].sort()) !== JSON.stringify([...(company.sector ?? [])].sort())) {
        sets.push("extracted_keywords = '{}'");
      }
      params.push(companyId);
      await db.query(`UPDATE companies SET ${sets.join(", ")}, updated_at = now() WHERE id = $${params.length}`, params);
    }
  } else if (section === "productMarket") {
    const { productStage, ...rest } = data;
    await db.query(
      `UPDATE companies SET product_stage = $1, product_market = $2,
         geography = CASE WHEN cardinality($3::text[]) > 0 THEN $3::text[] ELSE geography END, updated_at = now() WHERE id = $4`,
      [productStage ?? null, rest, data.targetGeographies ?? [], companyId]
    );
  } else if (section === "traction") {
    const { summary, ...metrics } = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null && v !== "")) as Record<string, any>;
    await db.query("UPDATE companies SET traction_metrics = $1, traction = $2, updated_at = now() WHERE id = $3", [
      JSON.stringify(metrics),
      typeof summary === "string" ? summary : null,
      companyId,
    ]);
  } else if (section === "fundraising") {
    const ask = data.targetAmountUsd != null ? Math.min(Math.round(data.targetAmountUsd), 2_000_000_000) : null;
    await db.query(
      `UPDATE companies SET fundraising = $1, stage = COALESCE($2, stage), ask_amount_usd = COALESCE($3, ask_amount_usd), updated_at = now() WHERE id = $4`,
      [data, data.stage ?? null, ask, companyId]
    );
  } else if (section === "preferences") {
    await db.query("UPDATE companies SET investor_preferences = $1, updated_at = now() WHERE id = $2", [data, companyId]);
  } else if (section === "documents") {
    await db.query("UPDATE companies SET documents = $1, updated_at = now() WHERE id = $2", [data, companyId]);
  }
  // Profile changed: a previously confirmed AI summary no longer reflects it.
  await db.query("UPDATE company_ai_profiles SET status = 'DRAFT', updated_at = now() WHERE company_id = $1 AND status = 'CONFIRMED'", [companyId]);
  return loadProfile(companyId, userId, db);
}

const FOUNDER_COLUMNS: [keyof FounderInput, string][] = [
  ["fullName", "full_name"],
  ["role", "role"],
  ["linkedinUrl", "linkedin_url"],
  ["location", "location"],
  ["education", "education"],
  ["experience", "experience"],
  ["previousCompanies", "previous_companies"],
  ["domainExpertise", "domain_expertise"],
  ["skills", "skills"],
  ["previousFounder", "previous_founder"],
  ["motivation", "motivation"],
  ["uniqueInsight", "unique_insight"],
  ["commitment", "commitment"],
];

export async function upsertFounder(companyId: string, userId: string, founderId: string | null, input: FounderInput, db: Queryable = pool) {
  await ownedCompany(companyId, userId, db);
  const values = FOUNDER_COLUMNS.map(([k]) => (input as any)[k] ?? (k === "domainExpertise" || k === "skills" ? [] : null));
  if (founderId) {
    const sets = FOUNDER_COLUMNS.map(([, col], i) => `${col} = $${i + 1}`).join(", ");
    const res = await db.query(
      `UPDATE company_founders SET ${sets}, updated_at = now() WHERE id = $${values.length + 1} AND company_id = $${values.length + 2} RETURNING *`,
      [...values, founderId, companyId]
    );
    if (!res.rows[0]) throw new ProfileError(404, "Founder not found.");
    return toFounder(res.rows[0]);
  }
  const count = (await db.query("SELECT COUNT(*)::int AS n FROM company_founders WHERE company_id = $1", [companyId])).rows[0].n;
  if (count >= 8) throw new ProfileError(400, "A company can list at most 8 founders.");
  const cols = FOUNDER_COLUMNS.map(([, c]) => c).join(", ");
  const placeholders = values.map((_, i) => `$${i + 3}`).join(", ");
  const res = await db.query(
    `INSERT INTO company_founders (company_id, position, ${cols}) VALUES ($1, $2, ${placeholders}) RETURNING *`,
    [companyId, count, ...values]
  );
  return toFounder(res.rows[0]);
}

export async function deleteFounder(companyId: string, userId: string, founderId: string, db: Queryable = pool) {
  await ownedCompany(companyId, userId, db);
  const row = (await db.query("SELECT user_id FROM company_founders WHERE id = $1 AND company_id = $2", [founderId, companyId])).rows[0];
  if (!row) throw new ProfileError(404, "Founder not found.");
  if (row.user_id) throw new ProfileError(400, "You can edit your own founder profile but not remove it.");
  await db.query("DELETE FROM company_founders WHERE id = $1", [founderId]);
}

export async function setOnboardingStep(companyId: string, userId: string, step: number, db: Queryable = pool) {
  await ownedCompany(companyId, userId, db);
  await db.query("UPDATE companies SET onboarding_step = GREATEST(onboarding_step, $1), updated_at = now() WHERE id = $2", [
    Math.max(0, Math.min(7, Math.floor(step))),
    companyId,
  ]);
}

/** Onboarding finishes only with all required fields AND a founder-confirmed profile summary. */
export async function completeOnboarding(companyId: string, userId: string, db: Queryable = pool) {
  const profile = await loadProfile(companyId, userId, db);
  if (!profile.completeness.canComplete) {
    throw new ProfileError(400, "Some required information is still missing.", { missing: profile.completeness.missingRequired });
  }
  if (profile.intelligence?.status !== "CONFIRMED") {
    throw new ProfileError(400, "Review and confirm your company profile summary first.");
  }
  await db.query("UPDATE companies SET onboarding_completed_at = COALESCE(onboarding_completed_at, now()), onboarding_step = 7 WHERE id = $1", [companyId]);
  return loadProfile(companyId, userId, db);
}

export async function setAiConsent(companyId: string, userId: string, consent: boolean, db: Queryable = pool) {
  await ownedCompany(companyId, userId, db);
  await db.query("UPDATE companies SET ai_financials_consent = $1 WHERE id = $2", [consent, companyId]);
}
