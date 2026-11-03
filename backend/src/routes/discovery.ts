import { Router, Response } from "express";
import { z } from "zod";
import { pool } from "../lib/db";
import { requireAuth } from "../lib/auth";
import { ProfileError, resolveCompanyId } from "../services/companyProfileService";
import { buildCompanyProfile, loadWeights, rankForCompany, RankedCompany, toInvestorProfile, toMatchResponse } from "../services/matchingContext";
import { fundKey, normalizeMatchTerm, scoreInvestor } from "../services/matchingService";
import { loadEntitlement } from "../services/entitlementService";

export const discoveryRouter = Router();
discoveryRouter.use(requireAuth);

function fail(res: Response, err: unknown) {
  if (err instanceof ProfileError) return res.status(err.status).json({ error: err.message });
  throw err;
}

const INCOMPLETE = {
  error: "Add your funding stage and industry to your company profile to see investor matches.",
  incomplete: true,
};

async function ranking(userId: string, companyId: string | undefined) {
  const id = await resolveCompanyId(userId, companyId ?? null);
  if (!id) throw new ProfileError(404, "Create your company profile first.");
  const r = await rankForCompany(userId, id);
  if (!r) throw new ProfileError(404, "Company not found.");
  return { id, r };
}

const listSchema = z.object({
  companyId: z.string().optional(),
  view: z.enum(["people", "funds"]).default("people"),
  list: z.enum(["all", "saved", "excluded"]).default("all"),
  q: z.string().trim().max(100).optional(),
  stage: z.string().max(30).optional(),
  sector: z.string().max(60).optional(),
  geo: z.string().max(60).optional(),
  investorType: z.string().max(30).optional(),
  minScore: z.coerce.number().min(0).max(100).default(0),
  minCheck: z.coerce.number().min(0).optional(),
  maxCheck: z.coerce.number().min(0).optional(),
  hideContacted: z.enum(["true", "false"]).default("false"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

discoveryRouter.get("/matches", async (req, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid query." });
  const f = parsed.data;
  try {
    const { id, r } = await ranking(req.auth!.userId, f.companyId);
    if (r === "incomplete") return res.status(409).json(INCOMPLETE);

    if (f.list === "excluded") {
      const rows = (
        await pool.query(
          `SELECT i.* FROM company_investor_lists l JOIN investors i ON i.id = l.investor_id
           WHERE l.company_id = $1 AND l.list = 'EXCLUDED' ORDER BY l.created_at DESC`,
          [id]
        )
      ).rows;
      return res.json({
        view: "people",
        total: rows.length,
        totalMatches: r.ranked.length,
        totalFunds: new Set(r.ranked.map((m) => fundKey(r.investors.get(m.investorId)!.firm))).size,
        page: 1,
        pageSize: rows.length,
        items: rows.map((row) => ({ id: row.id, name: row.name, title: row.title, firm: row.firm, fundKey: fundKey(row.firm), excluded: true })),
      });
    }

    const term = (s?: string) => (s ? normalizeMatchTerm(s) : null);
    const q = f.q?.toLowerCase();
    const items = r.ranked.filter((m) => {
      const inv = r.investors.get(m.investorId)!;
      if (m.score < f.minScore) return false;
      if (f.list === "saved" && !r.saved.has(inv.id)) return false;
      if (f.hideContacted === "true" && r.alreadyContacted.has(inv.id)) return false;
      if (q && !`${inv.name} ${inv.firm} ${inv.title ?? ""}`.toLowerCase().includes(q)) return false;
      if (f.stage && !inv.stageFocus.includes(f.stage as any)) return false;
      if (f.sector && ![...inv.sectorFocus, ...(inv.subSectors ?? [])].some((s) => normalizeMatchTerm(s) === term(f.sector))) return false;
      if (f.geo && !inv.geoFocus.some((g) => normalizeMatchTerm(g) === term(f.geo))) return false;
      if (f.investorType && inv.investorType !== f.investorType) return false;
      if (f.minCheck != null && inv.checkSizeMaxUsd != null && inv.checkSizeMaxUsd < f.minCheck) return false;
      if (f.maxCheck != null && inv.checkSizeMinUsd != null && inv.checkSizeMinUsd > f.maxCheck) return false;
      return true;
    });

    const base = {
      totalMatches: r.ranked.length,
      totalFunds: new Set(r.ranked.map((m) => fundKey(r.investors.get(m.investorId)!.firm))).size,
      matchableInvestors: r.matchableCount,
      page: f.page,
      pageSize: f.pageSize,
    };

    if (f.view === "funds") {
      const funds = new Map<string, { firm: string; people: ReturnType<typeof toMatchResponse>[] }>();
      for (const m of items) {
        const match = toMatchResponse(r, m);
        const entry = funds.get(match.fundKey) ?? { firm: match.firm.trim(), people: [] };
        entry.people.push(match);
        funds.set(match.fundKey, entry);
      }
      const all = [...funds.entries()].map(([key, v]) => fundSummary(key, v.firm, v.people));
      all.sort((a, b) => b.bestScore - a.bestScore);
      return res.json({ ...base, view: "funds", total: all.length, items: all.slice((f.page - 1) * f.pageSize, f.page * f.pageSize) });
    }

    res.json({
      ...base,
      view: "people",
      total: items.length,
      items: items.slice((f.page - 1) * f.pageSize, f.page * f.pageSize).map((m) => toMatchResponse(r, m)),
    });
  } catch (err) {
    fail(res, err);
  }
});

function fundSummary(key: string, firm: string, people: ReturnType<typeof toMatchResponse>[]) {
  const union = (xs: string[][]) => [...new Set(xs.flat())];
  const mins = people.map((p) => p.checkSizeMinUsd).filter((x): x is number => x != null);
  const maxs = people.map((p) => p.checkSizeMaxUsd).filter((x): x is number => x != null);
  const best = people[0]!;
  return {
    fundKey: key,
    firm,
    bestScore: best.score,
    peopleCount: people.length,
    stages: union(people.map((p) => p.stageFocus)),
    sectors: union(people.map((p) => p.sectorFocus)),
    geographies: union(people.map((p) => p.geoFocus)),
    checkSizeMinUsd: mins.length ? Math.min(...mins) : null,
    checkSizeMaxUsd: maxs.length ? Math.max(...maxs) : null,
    // The best-matched person is the recommended contact at this fund.
    recommendedContact: { id: best.id, name: best.name, title: best.title, score: best.score, reasons: best.reasons.slice(0, 2) },
    alreadyContacted: people.some((p) => p.alreadyContacted),
  };
}

/** Fund detail: aggregate of its investor records + each person's match (or why they don't match). */
discoveryRouter.get("/funds/:fundKey", async (req, res) => {
  try {
    const { r } = await ranking(req.auth!.userId, req.query.companyId as string | undefined);
    if (r === "incomplete") return res.status(409).json(INCOMPLETE);
    const key = fundKey(req.params.fundKey);
    const rows = (await pool.query("SELECT * FROM investors WHERE lower(regexp_replace(trim(firm), '\\s+', ' ', 'g')) = $1 AND is_verified = true", [key])).rows;
    if (!rows.length) return res.status(404).json({ error: "Fund not found." });
    const people = await describePeople(r, rows);
    const firstWithText = rows.find((x) => x.fund_description) ?? rows[0];
    const union = (col: string) => [...new Set(rows.flatMap((x) => x[col] ?? []))];
    res.json({
      fundKey: key,
      firm: rows[0].firm.trim(),
      description: firstWithText.fund_description ?? null,
      website: rows.find((x) => x.website)?.website ?? null,
      investorTypes: [...new Set(rows.map((x) => x.investor_type).filter(Boolean))],
      stages: union("stage_focus"),
      sectors: union("sector_focus"),
      subSectors: union("sub_sectors"),
      geographies: union("geo_focus"),
      thesisKeywords: union("thesis_keywords"),
      portfolio: union("portfolio_companies"),
      checkSizeMinUsd: extreme(rows.map((x) => x.check_size_min_usd), Math.min),
      checkSizeMaxUsd: extreme(rows.map((x) => x.check_size_max_usd), Math.max),
      fundStatus: rows.some((x) => x.fund_status === "ACTIVE") ? "ACTIVE" : rows.every((x) => x.fund_status === "NOT_INVESTING") ? "NOT_INVESTING" : "UNKNOWN",
      people: people.sort((a, b) => (b.match?.score ?? -1) - (a.match?.score ?? -1)),
    });
  } catch (err) {
    fail(res, err);
  }
});

function extreme(values: (number | null)[], pick: (...n: number[]) => number): number | null {
  const known = values.filter((v): v is number => v != null);
  return known.length ? pick(...known) : null;
}

async function describePeople(r: RankedCompany, rows: any[]) {
  const profile = await buildCompanyProfile(r.company);
  const weights = await loadWeights();
  const rankedIds = new Map(r.ranked.map((m) => [m.investorId, m]));
  return rows.map((row) => {
    const inv = toInvestorProfile(row);
    const ranked = rankedIds.get(inv.id);
    const scored = ranked ?? scoreInvestor(profile, inv, null, new Date(), weights);
    return {
      id: inv.id,
      name: inv.name,
      title: inv.title,
      linkedinUrl: row.linkedin_url,
      match: ranked ? toMatchResponse(r, ranked) : null,
      // Why this person isn't a match — shown instead of a fabricated score.
      notMatchedReason: ranked ? null : scored.exclusionReason ?? "Weak fit on the information available.",
      saved: r.saved.has(inv.id),
      alreadyContacted: r.alreadyContacted.has(inv.id),
    };
  });
}

discoveryRouter.get("/people/:id", async (req, res) => {
  try {
    const { r } = await ranking(req.auth!.userId, req.query.companyId as string | undefined);
    if (r === "incomplete") return res.status(409).json(INCOMPLETE);
    const row = (await pool.query("SELECT * FROM investors WHERE id = $1 AND is_verified = true", [req.params.id])).rows[0];
    if (!row) return res.status(404).json({ error: "Investor not found." });
    const [person] = await describePeople(r, [row]);
    res.json({
      ...person,
      firm: row.firm.trim(),
      fundKey: fundKey(row.firm),
      investorType: row.investor_type,
      stageFocus: row.stage_focus,
      sectorFocus: row.sector_focus,
      geoFocus: row.geo_focus,
      thesisKeywords: row.thesis_keywords,
      portfolio: row.portfolio_companies,
      checkSizeMinUsd: row.check_size_min_usd,
      checkSizeMaxUsd: row.check_size_max_usd,
      leadsRounds: row.leads_rounds,
      source: row.source,
      sourceVerifiedAt: row.source_verified_at,
    });
  } catch (err) {
    fail(res, err);
  }
});

const listUpdateSchema = z.object({
  companyId: z.string().optional(),
  investorId: z.string().min(1),
  list: z.enum(["SAVED", "EXCLUDED"]).nullable(),
});

discoveryRouter.put("/lists", async (req, res) => {
  const parsed = listUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input." });
  try {
    const id = await resolveCompanyId(req.auth!.userId, parsed.data.companyId ?? null);
    if (!id) return res.status(404).json({ error: "Create your company profile first." });
    const exists = (await pool.query("SELECT 1 FROM investors WHERE id = $1 AND is_verified = true", [parsed.data.investorId])).rows[0];
    if (!exists) return res.status(404).json({ error: "Investor not found." });
    if (parsed.data.list === null) {
      await pool.query("DELETE FROM company_investor_lists WHERE company_id = $1 AND investor_id = $2", [id, parsed.data.investorId]);
    } else {
      await pool.query(
        `INSERT INTO company_investor_lists (company_id, investor_id, list) VALUES ($1, $2, $3)
         ON CONFLICT (company_id, investor_id) DO UPDATE SET list = $3, created_at = now()`,
        [id, parsed.data.investorId, parsed.data.list]
      );
    }
    res.json({ ok: true, list: parsed.data.list });
  } catch (err) {
    fail(res, err);
  }
});

/** Plan context for discovery: how many investors the next campaign can include. */
discoveryRouter.get("/allowance", async (req, res) => {
  const e = await loadEntitlement(req.auth!.userId);
  res.json({ tier: e.tier, limit: e.quota.limit, remainingToAllocate: e.quota.remainingToAllocate });
});
