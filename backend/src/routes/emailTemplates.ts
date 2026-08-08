import { Router } from "express";
import { z } from "zod";
import { pool } from "../lib/db";
import { requireAuth } from "../lib/auth";

export const emailTemplateRouter = Router();
emailTemplateRouter.use(requireAuth);

emailTemplateRouter.get("/", async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM email_templates WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC",
    [req.auth!.userId]
  );
  res.json(result.rows.map(toResponse));
});

const templateSchema = z.object({
  name: z.string().min(1).max(100),
  subject: z.string().min(1).max(200),
  body: z.string().min(1),
  isDefault: z.boolean().optional(),
});

emailTemplateRouter.post("/", async (req, res) => {
  const parsed = templateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const v = parsed.data;
  const userId = req.auth!.userId;

  if (v.isDefault) {
    await pool.query("UPDATE email_templates SET is_default = false WHERE user_id = $1", [userId]);
  }

  const result = await pool.query(
    `INSERT INTO email_templates (user_id, name, subject, body, is_default) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [userId, v.name, v.subject, v.body, v.isDefault ?? false]
  );
  res.status(201).json(toResponse(result.rows[0]));
});

emailTemplateRouter.patch("/:id", async (req, res) => {
  const parsed = templateSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const v = parsed.data;
  const userId = req.auth!.userId;

  const existing = await pool.query("SELECT * FROM email_templates WHERE id = $1 AND user_id = $2", [
    req.params.id,
    userId,
  ]);
  if (existing.rows.length === 0) return res.status(404).json({ error: "Template not found." });

  if (v.isDefault) {
    await pool.query("UPDATE email_templates SET is_default = false WHERE user_id = $1", [userId]);
  }

  const current = existing.rows[0];
  const result = await pool.query(
    `UPDATE email_templates SET name = $1, subject = $2, body = $3, is_default = $4 WHERE id = $5 RETURNING *`,
    [
      v.name ?? current.name,
      v.subject ?? current.subject,
      v.body ?? current.body,
      v.isDefault ?? current.is_default,
      req.params.id,
    ]
  );
  res.json(toResponse(result.rows[0]));
});

emailTemplateRouter.delete("/:id", async (req, res) => {
  const result = await pool.query("DELETE FROM email_templates WHERE id = $1 AND user_id = $2 RETURNING id", [
    req.params.id,
    req.auth!.userId,
  ]);
  if (result.rows.length === 0) return res.status(404).json({ error: "Template not found." });
  res.json({ ok: true });
});

function toResponse(row: any) {
  return {
    id: row.id,
    name: row.name,
    subject: row.subject,
    body: row.body,
    isDefault: row.is_default,
    createdAt: row.created_at,
  };
}
