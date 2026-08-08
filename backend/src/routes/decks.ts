import { Router } from "express";
import multer from "multer";
import * as path from "path";
import * as fs from "fs";
import { pool } from "../lib/db";
import { requireAuth } from "../lib/auth";
import { AIProviderUnavailableError, generateDeckSections, isAIFeatureAvailable } from "../lib/llmService";

export const deckRouter = Router();
deckRouter.use(requireAuth);

const UPLOAD_DIR = path.join(process.cwd(), "uploads", "decks");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_DECK_TYPES: Record<string, string> = {
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/pdf": "pdf",
};

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = ALLOWED_DECK_TYPES[file.mimetype] || "bin";
      cb(null, `${req.auth!.userId}-${Date.now()}.${ext}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB — decks with embedded images/screenshots can be large
  fileFilter: (req, file, cb) => {
    if (ALLOWED_DECK_TYPES[file.mimetype]) return cb(null, true);
    cb(new Error("Only .pptx and .pdf files are accepted for deck upload."));
  },
});

/**
 * Uploads a founder's own deck (PPTX or PDF) instead of generating one. This is the
 * required fallback when ANTHROPIC_API_KEY isn't configured — see the /generate route
 * below for the automatic switch-back once a key is added. The uploaded deck becomes
 * the version everywhere a deck is referenced (company page, campaign context), same as
 * a generated one, distinguished only by `source: 'uploaded'`.
 */
deckRouter.post("/:companyId/upload", upload.single("deck"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded. Field name must be 'deck'." });

  const userId = req.auth!.userId;
  const companyResult = await pool.query("SELECT id FROM companies WHERE id = $1 AND user_id = $2", [
    req.params.companyId,
    userId,
  ]);
  if (companyResult.rows.length === 0) {
    fs.unlinkSync(req.file.path); // don't leave an orphaned file for a company the user doesn't own
    return res.status(404).json({ error: "Company not found." });
  }

  const fileType = ALLOWED_DECK_TYPES[req.file.mimetype];
  const versionResult = await pool.query(
    "SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM decks WHERE company_id = $1",
    [req.params.companyId]
  );

  const deckResult = await pool.query(
    `INSERT INTO decks (company_id, version, source, uploaded_file_path, uploaded_file_type, uploaded_file_name)
     VALUES ($1, $2, 'uploaded', $3, $4, $5) RETURNING *`,
    [req.params.companyId, versionResult.rows[0].next_version, req.file.path, fileType, req.file.originalname]
  );

  res.status(201).json(toDeckResponse(deckResult.rows[0]));
});

/** Serves the raw uploaded file for preview/download — ownership-checked. */
deckRouter.get("/file/:deckId", async (req, res) => {
  const userId = req.auth!.userId;
  const result = await pool.query(
    `SELECT d.* FROM decks d JOIN companies c ON c.id = d.company_id WHERE d.id = $1 AND c.user_id = $2`,
    [req.params.deckId, userId]
  );
  const deck = result.rows[0];
  if (!deck || deck.source !== "uploaded" || !deck.uploaded_file_path) {
    return res.status(404).json({ error: "No uploaded file for this deck." });
  }
  res.sendFile(deck.uploaded_file_path);
});


/**
 * Generates a new deck (or a new version) for a company the user owns. Blocked entirely
 * when ANTHROPIC_API_KEY isn't configured — per spec, missing generation capability means
 * founders upload their own deck instead (see /upload above), not a degraded mock output
 * presented as if it were real deck content.
 */
deckRouter.post("/:companyId/generate", async (req, res) => {
  if (!isAIFeatureAvailable("deck")) {
    return res.status(400).json({
      error: "AI deck generation is not available right now. Upload your own deck (PPTX or PDF) instead.",
      generationDisabled: true,
    });
  }

  const userId = req.auth!.userId;
  const companyResult = await pool.query("SELECT * FROM companies WHERE id = $1 AND user_id = $2", [
    req.params.companyId,
    userId,
  ]);
  const company = companyResult.rows[0];
  if (!company) return res.status(404).json({ error: "Company not found." });

  let generation;
  try {
    generation = await generateDeckSections({
      companyName: company.name,
      oneLiner: company.one_liner,
      problem: company.problem,
      solution: company.solution,
      stage: company.stage,
      sector: company.sector,
      askAmountUsd: company.ask_amount_usd,
      traction: company.traction ?? undefined,
      founderBackground: company.founder_background ?? undefined,
    });
  } catch (err) {
    if (err instanceof AIProviderUnavailableError) {
      return res.status(503).json({
        error: "AI deck generation is temporarily unavailable. Upload your own deck or try again later.",
        generationDisabled: true,
      });
    }
    throw err;
  }

  // Persist the LLM-extracted keywords back onto the company — matchingService.ts uses
  // these directly for sector/thesis scoring, so this must happen before any campaign is created.
  await pool.query("UPDATE companies SET extracted_keywords = $1 WHERE id = $2", [
    generation.sections.extractedKeywords,
    company.id,
  ]);

  const versionResult = await pool.query(
    "SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM decks WHERE company_id = $1",
    [company.id]
  );
  const nextVersion = versionResult.rows[0].next_version;

  const deckResult = await pool.query(
    `INSERT INTO decks (company_id, version, source, sections_json) VALUES ($1, $2, 'generated', $3) RETURNING *`,
    [company.id, nextVersion, JSON.stringify(generation.sections)]
  );

  res.status(201).json({
    deck: toDeckResponse(deckResult.rows[0]),
    provider: generation.provider,
  });
});

/** Lets the frontend know whether to show "Generate" or "Upload" as the primary deck flow. */
deckRouter.get("/config/status", (_req, res) => {
  res.json({ generationAvailable: isAIFeatureAvailable("deck") });
});

deckRouter.get("/:companyId", async (req, res) => {
  const userId = req.auth!.userId;
  const ownership = await pool.query("SELECT id FROM companies WHERE id = $1 AND user_id = $2", [
    req.params.companyId,
    userId,
  ]);
  if (ownership.rows.length === 0) return res.status(404).json({ error: "Company not found." });

  const result = await pool.query(
    "SELECT * FROM decks WHERE company_id = $1 ORDER BY version DESC",
    [req.params.companyId]
  );
  res.json(result.rows.map(toDeckResponse));
});

function toDeckResponse(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    version: row.version,
    source: row.source,
    sections: row.sections_json,
    uploadedFileName: row.uploaded_file_name,
    uploadedFileType: row.uploaded_file_type,
    pdfUrl: row.pdf_url,
    createdAt: row.created_at,
  };
}
