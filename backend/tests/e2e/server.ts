/**
 * Local end-to-end server: the real Express app on an in-process Postgres (PGlite) with
 * seeded investors. External services are stubbed so NOTHING leaves this machine:
 *  - AI email/deck generation returns deterministic text
 *  - Gmail delivery records the email instead of sending it
 *  - Razorpay is never called (no keys)
 *
 *   npx tsx tests/e2e/server.ts        # API on :4100, then point the frontend at it
 *
 * Never run this with real credentials in the environment; it sets its own.
 */
import * as path from "path";

Object.assign(process.env, {
  NODE_ENV: "test",
  JWT_SECRET: "e2e_jwt_secret",
  REFRESH_TOKEN_ENCRYPTION_KEY: "c".repeat(64),
  FRONTEND_URL: process.env.E2E_FRONTEND_URL || "http://localhost:3100",
  GMAIL_WATCHER_ENABLED: "false",
  SMTP_FALLBACK_ENABLED: "false",
  RAZORPAY_KEY_ID: "",
  RAZORPAY_KEY_SECRET: "",
  GOOGLE_CLIENT_ID: "e2e-client",
  GOOGLE_CLIENT_SECRET: "e2e-secret",
  // Deck generation uses the built-in dev-only mock provider; real AI keys are blanked.
  ALLOW_MOCK_AI: "true",
  DECK_PROVIDER_PRIORITY: "mock",
  EMAIL_PROVIDER_PRIORITY: "mock",
  GROQ_API_KEY: "",
  GEMINI_API_KEY: "",
  OPENROUTER_API_KEY: "",
  ANTHROPIC_API_KEY: "",
  DATABASE_URL: "",
});

const src = (p: string) => require.resolve(path.join(__dirname, "..", "..", "src", p));
function stub(file: string, exports: Record<string, unknown>) {
  const id = src(file);
  require.cache[id] = { id, filename: id, loaded: true, exports } as any;
}

async function main() {
  const testDb = await import("../integration/testDb");
  await testDb.getTestDb();
  stub("lib/db", testDb);

  const sent: { to: string; subject: string }[] = [];
  const realDelivery = require(src("lib/emailDelivery"));
  stub("lib/emailDelivery", {
    ...realDelivery,
    deliverEmail: async (_userId: string, email: { to: string; subject: string }) => {
      sent.push({ to: email.to, subject: email.subject });
      return { delivered: true, via: "gmail_api", messageId: `e2e_${sent.length}`, threadId: `e2e_t_${sent.length}` };
    },
  });
  const realLlm = require(src("lib/llmService"));
  stub("lib/llmService", {
    ...realLlm,
    isAIFeatureAvailable: () => true,
    generatePersonalizedEmail: async (i: any) => ({
      subject: `${i.companyName} — raising $${i.askAmountUsd.toLocaleString()}`,
      body: `Hi ${i.investorName},\n\n${i.companyName}: ${i.oneLiner}. ${i.matchReasons[0] ?? ""}.\n\nBest,\n${i.founderName}`,
      provider: "mock",
    }),
  });

  const { pool } = testDb;
  for (let i = 0; i < 60; i++) {
    await pool.query(
      `INSERT INTO investors (name, firm, email, stage_focus, sector_focus, geo_focus, check_size_min_usd, check_size_max_usd, is_verified, needs_enrichment)
       VALUES ($1, $2, $3, '{SEED,PRE_SEED}', $4, '{India}', 100000, 2000000, true, false)`,
      [`Investor ${i + 1}`, `Example Fund ${(i % 12) + 1}`, `investor${i + 1}@example.test`, i % 3 === 0 ? ["Fintech", "SaaS"] : ["Fintech"]]
    );
  }
  const { hashPassword } = require(src("lib/auth"));
  await pool.query("INSERT INTO users (email, name, role, password_hash) VALUES ('admin@example.test', 'Admin', 'ADMIN', $1)", [await hashPassword("admin1234")]);

  const { app } = require(src("app"));
  app.get("/__e2e/sent", (_req: any, res: any) => res.json(sent));
  // Simulates a Gmail connection for a user (the real flow needs Google).
  app.post("/__e2e/connect-gmail/:email", async (req: any, res: any) => {
    const { encryptToken } = require(src("lib/tokenEncryption"));
    await pool.query(
      `UPDATE users SET google_refresh_token = $1, connected_gmail_address = email, gmail_connected_at = now(),
         gmail_granted_scopes = 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.metadata' WHERE email = $2`,
      [encryptToken("e2e"), req.params.email]
    );
    res.json({ ok: true });
  });
  const port = Number(process.env.E2E_API_PORT || 4100);
  app.listen(port, () => console.log(`E2E API on :${port}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
