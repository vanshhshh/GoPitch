import request from "supertest";
import type { Express } from "express";
import { pool } from "./testDb";

export const TEST_ENV = {
  NODE_ENV: "test",
  JWT_SECRET: "integration_test_jwt_secret",
  REFRESH_TOKEN_ENCRYPTION_KEY: "a".repeat(64),
  RAZORPAY_KEY_ID: "rzp_test_dummy",
  RAZORPAY_KEY_SECRET: "rzp_test_secret",
  RAZORPAY_WEBHOOK_SECRET: "whsec_test",
  GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "test-google-secret",
  FRONTEND_URL: "http://localhost:3000",
  GMAIL_WATCHER_ENABLED: "false",
  SMTP_FALLBACK_ENABLED: "false",
};

/** Applied before the app is imported so dotenv (which never overrides) can't load real secrets over them. */
export function applyTestEnv() {
  Object.assign(process.env, TEST_ENV);
}

let ipCounter = 1;
/** Each request gets its own client IP so the per-IP rate limiters don't trip mid-suite. */
export function api(app: Express) {
  const ip = () => `10.0.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;
  const wrap = (method: "get" | "post" | "patch" | "delete") => (url: string, token?: string) => {
    const req = request(app)[method](url).set("X-Forwarded-For", ip());
    return token ? req.set("Authorization", `Bearer ${token}`) : req;
  };
  return { get: wrap("get"), post: wrap("post"), patch: wrap("patch"), delete: wrap("delete") };
}

export async function createUser(signToken: (p: any) => string, opts: { email?: string; role?: "FOUNDER" | "ADMIN"; name?: string } = {}) {
  const email = opts.email ?? `user_${Math.random().toString(36).slice(2)}@example.com`;
  const role = opts.role ?? "FOUNDER";
  const row = (
    await pool.query("INSERT INTO users (email, name, role) VALUES ($1, $2, $3) RETURNING id", [email, opts.name ?? "Test Founder", role])
  ).rows[0];
  return { id: row.id as string, email, token: signToken({ userId: row.id, role }) };
}

export async function connectGmail(userId: string, encrypted: string, daysAgo = 0) {
  await pool.query(
    `UPDATE users SET google_refresh_token = $1, connected_gmail_address = 'founder@gmail.test',
       gmail_connected_at = now() - ($2 || ' days')::interval, gmail_granted_scopes = 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.metadata'
     WHERE id = $3`,
    [encrypted, String(daysAgo), userId]
  );
}

export async function createCompany(userId: string, overrides: Record<string, any> = {}) {
  const row = (
    await pool.query(
      `INSERT INTO companies (user_id, name, one_liner, problem, solution, stage, sector, geography, ask_amount_usd)
       VALUES ($1, $2, 'Payments for freelancers', 'Slow payouts', 'Instant payouts', $3, $4, $5, $6) RETURNING id`,
      [userId, overrides.name ?? "Velo Pay", overrides.stage ?? "SEED", overrides.sector ?? ["fintech"], overrides.geography ?? ["India"], overrides.ask ?? 500000]
    )
  ).rows[0];
  return row.id as string;
}

/** n verified, enriched fintech/seed/India investors spread across `firms` funds (with spelling variants). */
export async function seedInvestors(n: number, firms = 10, prefix = "inv") {
  for (let i = 0; i < n; i++) {
    const fund = i % firms;
    const firm = i % 2 === 0 ? `Fund ${fund}` : ` fund ${fund} `; // same fund, different spelling
    await pool.query(
      `INSERT INTO investors (name, firm, email, stage_focus, sector_focus, geo_focus, check_size_min_usd, check_size_max_usd, is_verified, needs_enrichment)
       VALUES ($1, $2, $3, '{SEED}', '{fintech}', '{India}', 100000, 1000000, true, false)`,
      [`${prefix} ${i}`, firm, `${prefix}_${i}_${Math.random().toString(36).slice(2, 7)}@fund.test`]
    );
  }
}

export async function setSubscription(userId: string, tier: string, opts: { status?: string; periodEndDays?: number | null; periodStartDaysAgo?: number } = {}) {
  await pool.query(
    `INSERT INTO subscriptions (user_id, tier, status, current_period_start, current_period_end)
     VALUES ($1, $2, $3, now() - ($4 || ' days')::interval, CASE WHEN $5::int IS NULL THEN NULL ELSE now() + ($5 || ' days')::interval END)
     ON CONFLICT (user_id) DO UPDATE SET tier = EXCLUDED.tier, status = EXCLUDED.status,
       current_period_start = EXCLUDED.current_period_start, current_period_end = EXCLUDED.current_period_end`,
    [userId, tier, opts.status ?? "ACTIVE", String(opts.periodStartDaysAgo ?? 0), opts.periodEndDays === undefined ? 30 : opts.periodEndDays]
  );
}
