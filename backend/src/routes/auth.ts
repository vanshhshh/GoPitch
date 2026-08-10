import { Router } from "express";
import { z } from "zod";
import { pool } from "../lib/db";
import { hashPassword, verifyPassword, signToken, requireAuth } from "../lib/auth";

export const authRouter = Router();

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters."),
  name: z.string().min(1, "Name is required.").max(100),
});

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
  const result = await pool.query(
    `INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, 'FOUNDER') RETURNING id, email, name, role`,
    [email.toLowerCase(), passwordHash, name]
  );
  const user = result.rows[0];
  const token = signToken({ userId: user.id, role: user.role });
  res.status(201).json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
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
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const result = await pool.query(
    "SELECT id, email, name, role FROM users WHERE id = $1",
    [req.auth!.userId]
  );
  const user = result.rows[0];
  if (!user) return res.status(404).json({ error: "User not found." });

  const companyResult = await pool.query("SELECT id FROM companies WHERE user_id = $1 LIMIT 1", [req.auth!.userId]);
  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    hasCompany: companyResult.rows.length > 0,
  });
});
