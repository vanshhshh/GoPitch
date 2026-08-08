import { Router } from "express";
import { pool } from "../lib/db";
import { requireAuth } from "../lib/auth";

export const notificationRouter = Router();
notificationRouter.use(requireAuth);

notificationRouter.get("/", async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100",
    [req.auth!.userId]
  );
  res.json(result.rows.map(toResponse));
});

notificationRouter.post("/:id/read", async (req, res) => {
  const result = await pool.query(
    "UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2 RETURNING id",
    [req.params.id, req.auth!.userId]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: "Notification not found." });
  res.json({ ok: true });
});

notificationRouter.post("/read-all", async (req, res) => {
  await pool.query("UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL", [
    req.auth!.userId,
  ]);
  res.json({ ok: true });
});

/** Internal helper other routes call to create a notification — not exposed directly. */
export async function createNotification(userId: string, type: string, title: string, body?: string) {
  await pool.query(
    "INSERT INTO notifications (user_id, type, title, body) VALUES ($1,$2,$3,$4)",
    [userId, type, title, body ?? null]
  );
}

function toResponse(row: any) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}
