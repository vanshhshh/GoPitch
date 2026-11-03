import { Router, Response } from "express";
import { z } from "zod";
import { requireAuth } from "../lib/auth";
import { pool } from "../lib/db";
import {
  applicableTractionQuestions,
  BUSINESS_TYPES,
  COMPLETENESS,
  founderSchema,
  FUNDING_STAGES,
  INSTRUMENTS,
  INVESTOR_TYPES,
  PRODUCT_STAGES,
  SECTION_SCHEMAS,
  SectionName,
  SKILLS,
} from "../services/companyProfileSchema";
import {
  completeOnboarding,
  createDraftCompany,
  deleteFounder,
  loadProfile,
  ProfileError,
  resolveCompanyId,
  saveSection,
  setAiConsent,
  setOnboardingStep,
  upsertFounder,
} from "../services/companyProfileService";
import { confirmIntelligence, generateIntelligence, getIntelligence, saveIntelligenceEdits } from "../services/companyIntelligence";

export const companyProfileRouter = Router();
companyProfileRouter.use(requireAuth);

function fail(res: Response, err: unknown) {
  if (err instanceof ProfileError) return res.status(err.status).json({ error: err.message, details: err.details });
  throw err;
}

/** Question catalog: option lists + the traction questions that apply to this company. */
companyProfileRouter.get("/questions", (req, res) => {
  const list = (v: unknown) => (typeof v === "string" && v ? v.split(",") : []);
  res.json({
    options: { fundingStages: FUNDING_STAGES, productStages: PRODUCT_STAGES, businessTypes: BUSINESS_TYPES, instruments: INSTRUMENTS, investorTypes: INVESTOR_TYPES, skills: SKILLS },
    traction: applicableTractionQuestions({
      businessTypes: list(req.query.businessTypes),
      industries: list(req.query.industries),
      productStage: typeof req.query.productStage === "string" ? req.query.productStage : null,
    }),
    completeness: COMPLETENESS,
  });
});

/** All of the founder's companies (for the workspace switcher). */
companyProfileRouter.get("/companies", async (req, res) => {
  const rows = (
    await pool.query(
      "SELECT id, name, one_liner, onboarding_completed_at, created_at FROM companies WHERE user_id = $1 ORDER BY created_at",
      [req.auth!.userId]
    )
  ).rows;
  res.json(rows.map((r) => ({ id: r.id, name: r.name || "Untitled company", oneLiner: r.one_liner, onboardingComplete: !!r.onboarding_completed_at })));
});

/** Active profile: ?companyId=… or the founder's primary company. 204 when none exists yet. */
companyProfileRouter.get("/", async (req, res) => {
  try {
    const id = await resolveCompanyId(req.auth!.userId, (req.query.companyId as string) || null);
    if (!id) return res.status(204).end();
    res.json(await loadProfile(id, req.auth!.userId));
  } catch (err) {
    fail(res, err);
  }
});

const createSchema = z.object({ name: z.string().trim().min(1, "Company name is required.").max(120) });

/** Starts onboarding (or an additional company). Re-uses an unfinished draft instead of duplicating it. */
companyProfileRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const userId = req.auth!.userId;
  const existingDraft = (
    await pool.query("SELECT id FROM companies WHERE user_id = $1 AND onboarding_completed_at IS NULL ORDER BY created_at DESC LIMIT 1", [userId])
  ).rows[0];
  if (existingDraft && req.body?.additional !== true) {
    await pool.query("UPDATE companies SET name = $1 WHERE id = $2", [parsed.data.name, existingDraft.id]);
    return res.status(200).json(await loadProfile(existingDraft.id, userId));
  }
  const id = await createDraftCompany(userId, parsed.data.name);
  res.status(201).json(await loadProfile(id, userId));
});

const SECTIONS = Object.keys(SECTION_SCHEMAS) as SectionName[];

companyProfileRouter.put("/:id/sections/:section", async (req, res) => {
  const section = req.params.section as SectionName;
  if (!SECTIONS.includes(section)) return res.status(404).json({ error: "Unknown section." });
  try {
    res.json(await saveSection(req.params.id, req.auth!.userId, section, req.body));
  } catch (err) {
    fail(res, err);
  }
});

companyProfileRouter.post("/:id/founders", async (req, res) => {
  const parsed = founderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message, details: { field: parsed.error.issues[0]?.path.join(".") } });
  try {
    res.status(201).json(await upsertFounder(req.params.id, req.auth!.userId, null, parsed.data));
  } catch (err) {
    fail(res, err);
  }
});

companyProfileRouter.put("/:id/founders/:founderId", async (req, res) => {
  const parsed = founderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message, details: { field: parsed.error.issues[0]?.path.join(".") } });
  try {
    res.json(await upsertFounder(req.params.id, req.auth!.userId, req.params.founderId, parsed.data));
  } catch (err) {
    fail(res, err);
  }
});

companyProfileRouter.delete("/:id/founders/:founderId", async (req, res) => {
  try {
    await deleteFounder(req.params.id, req.auth!.userId, req.params.founderId);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

companyProfileRouter.post("/:id/onboarding/step", async (req, res) => {
  const step = Number(req.body?.step);
  if (!Number.isInteger(step) || step < 0 || step > 7) return res.status(400).json({ error: "step must be 0–7." });
  try {
    await setOnboardingStep(req.params.id, req.auth!.userId, step);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

companyProfileRouter.post("/:id/onboarding/complete", async (req, res) => {
  try {
    res.json(await completeOnboarding(req.params.id, req.auth!.userId));
  } catch (err) {
    fail(res, err);
  }
});

companyProfileRouter.put("/:id/ai-consent", async (req, res) => {
  if (typeof req.body?.consent !== "boolean") return res.status(400).json({ error: "consent must be true or false." });
  try {
    await setAiConsent(req.params.id, req.auth!.userId, req.body.consent);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

// ---------- Intelligence summary ----------
companyProfileRouter.get("/:id/intelligence", async (req, res) => {
  try {
    const intel = await getIntelligence(req.params.id, req.auth!.userId);
    if (!intel) return res.status(204).end();
    res.json(intel);
  } catch (err) {
    fail(res, err);
  }
});

companyProfileRouter.post("/:id/intelligence/generate", async (req, res) => {
  try {
    res.json(await generateIntelligence(req.params.id, req.auth!.userId));
  } catch (err) {
    fail(res, err);
  }
});

const editSchema = z.object({
  fields: z.record(z.string(), z.string().max(1000).nullable()).optional(),
  thesisCategories: z.array(z.string().max(60)).max(8).optional(),
});

companyProfileRouter.patch("/:id/intelligence", async (req, res) => {
  const parsed = editSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input." });
  try {
    res.json(await saveIntelligenceEdits(req.params.id, req.auth!.userId, parsed.data));
  } catch (err) {
    fail(res, err);
  }
});

companyProfileRouter.post("/:id/intelligence/confirm", async (req, res) => {
  try {
    res.json(await confirmIntelligence(req.params.id, req.auth!.userId));
  } catch (err) {
    fail(res, err);
  }
});
