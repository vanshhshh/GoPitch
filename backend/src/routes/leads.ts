import { Router } from "express";
import { z } from "zod";
import { pool } from "../lib/db";
import { verifyToken } from "../lib/auth";
import { publicWriteRateLimiter } from "../lib/rateLimiters";
import { notifyAdmins } from "./notifications";

export const leadsRouter = Router();

const leadSchema = z.object({
  name: z.string({ error: "Name is required." }).trim().min(1, "Name is required.").max(120),
  company: z.string({ error: "Company name is required." }).trim().min(1, "Company name is required.").max(200),
  email: z.string({ error: "Enter a valid business email." }).trim().email("Enter a valid business email.").max(254),
  phone: z
    .string({ error: "Phone number is required." })
    .trim()
    .min(1, "Phone number is required.")
    .max(30)
    .refine((p) => /^\+?[0-9 ()-]{7,}$/.test(p), "Enter a valid phone number."),
  outreachVolume: z.string({ error: "Select your expected email volume." }).trim().min(1, "Select your expected email volume.").max(50),
  message: z.string({ error: "Tell us about your requirements." }).trim().min(1, "Tell us about your requirements.").max(5000),
  website: z.string().trim().max(300).optional().or(z.literal("")),
  teamSize: z.string().trim().max(50).optional().or(z.literal("")),
  source: z.enum(["pricing", "billing", "contact"]).optional(),
});

/**
 * Enterprise "Talk to Sales" enquiries. Public (visitors on /pricing aren't logged in),
 * so it's IP rate limited. The submitter's account is taken from a valid Authorization
 * header if present — never from a user id in the body, which anyone could set.
 */
leadsRouter.post("/", publicWriteRateLimiter, async (req, res) => {
  const parsed = leadSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input." });
  const lead = parsed.data;

  let userId: string | null = null;
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    try {
      userId = verifyToken(header.slice(7)).userId;
    } catch {
      userId = null;
    }
  }

  // A double-click or resubmit of the same enquiry within 10 minutes is acknowledged
  // without creating a second lead for the sales team.
  const duplicate = await pool.query(
    "SELECT id FROM leads WHERE lower(email) = lower($1) AND message = $2 AND created_at > now() - interval '10 minutes' LIMIT 1",
    [lead.email, lead.message]
  );
  if (duplicate.rows.length > 0) return res.status(200).json({ ok: true, duplicate: true });

  await pool.query(
    `INSERT INTO leads (user_id, name, phone, email, company, website, team_size, outreach_volume, message, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [userId, lead.name, lead.phone, lead.email.toLowerCase(), lead.company, lead.website || null, lead.teamSize || null, lead.outreachVolume, lead.message, lead.source ?? null]
  );
  await notifyAdmins("enterprise_lead", `New enterprise enquiry: ${lead.company}`, `${lead.name} <${lead.email}> · ${lead.outreachVolume}`);

  res.status(201).json({ ok: true });
});
