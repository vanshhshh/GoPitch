import { Router } from "express";
import { z } from "zod";
import { pool } from "../lib/db";
import { hashPassword, verifyPassword, signToken, requireAuth } from "../lib/auth";
import { exchangeSignInCode } from "./googleAuth";

export const authRouter = Router();

const signupSchema = z.object({
  email: z.string().trim().email("Enter a valid email address.").max(254),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .max(128, "Password must be at most 128 characters.")
    .refine((p) => /[A-Za-z]/.test(p) && /[0-9]/.test(p), "Password must contain at least one letter and one number."),
  name: z.string().trim().min(1, "Name is required.").max(100),
});

/**
 * "Has a company" means a company that finished onboarding — a draft started during
 * onboarding (including after Google Sign-In) doesn't count, so new users are never
 * treated as onboarded prematurely. Existing companies were backfilled as complete.
 */
async function hasCompany(userId: string): Promise<boolean> {
  return (await pool.query("SELECT 1 FROM companies WHERE user_id = $1 AND onboarding_completed_at IS NOT NULL LIMIT 1", [userId])).rows.length > 0;
}

authRouter.post("/signup", async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input." });
  }
  const { email, password, name } = parsed.data;

  const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email.toLowerCase()]);
  if (existing.rows.length > 0) {
    return res.status(409).json({ error: "An account with this email already exists." });
  }

  const passwordHash = await hashPassword(password);
  // ON CONFLICT closes the race where two simultaneous signups both pass the check above.
  const result = await pool.query(
    `INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, 'FOUNDER')
     ON CONFLICT (email) DO NOTHING RETURNING id, email, name, role`,
    [email.toLowerCase(), passwordHash, name]
  );
  const user = result.rows[0];
  if (!user) return res.status(409).json({ error: "An account with this email already exists." });
  const token = signToken({ userId: user.id, role: user.role });
  res.status(201).json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role, hasCompany: false } });
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(128),
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid email or password." });
  }
  const { email, password } = parsed.data;

  const result = await pool.query(
    "SELECT id, email, name, password_hash, role FROM users WHERE email = $1",
    [email.toLowerCase()]
  );
  const user = result.rows[0];
  if (!user || !user.password_hash) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  const token = signToken({ userId: user.id, role: user.role });
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role, hasCompany: await hasCompany(user.id) } });
});

/** Second half of Google Sign-In: trades the one-time code from the redirect for a session. */
authRouter.post("/google/exchange", async (req, res) => {
  const code = typeof req.body?.code === "string" ? req.body.code : "";
  const exchanged = await exchangeSignInCode(code);
  if (!exchanged) return res.status(401).json({ error: "This sign-in link has expired. Please sign in again." });
  const { token, user } = exchanged;
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role, hasCompany: await hasCompany(user.id) } });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const result = await pool.query(
    "SELECT id, email, name, role FROM users WHERE id = $1",
    [req.auth!.userId]
  );
  const user = result.rows[0];
  if (!user) return res.status(401).json({ error: "This account no longer exists." });

  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    hasCompany: await hasCompany(user.id),
  });
});
