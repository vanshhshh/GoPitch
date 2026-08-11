import express from "express";
import cors from "cors";
import helmet from "helmet";
import * as dotenv from "dotenv";
import { authRouter } from "./routes/auth";
import { companyRouter } from "./routes/companies";
import { deckRouter } from "./routes/decks";
import { campaignRouter } from "./routes/campaigns";
import { sendRouter } from "./routes/sends";
import { adminRouter } from "./routes/admin";
import { billingRouter } from "./routes/billing";
import { googleAuthRouter } from "./routes/googleAuth";
import { emailTemplateRouter } from "./routes/emailTemplates";
import { notificationRouter } from "./routes/notifications";
import { profileRouter } from "./routes/profile";
import { leadsRouter } from "./routes/leads";
import { authRateLimiter, generalRateLimiter } from "./lib/rateLimiters";
import { assertRefreshTokenEncryptionKeyConfigured } from "./lib/tokenEncryption";
import { checkGmailRepliesForAllUsers } from "./services/gmailWatcher";

dotenv.config();
assertRefreshTokenEncryptionKeyConfigured();

export const app = express();

// Helmet sets a broad set of protective headers (X-Content-Type-Options, HSTS,
// X-Frame-Options, etc). CSP is left at helmet's default here since this API serves
// JSON, not HTML — a strict CSP matters for the frontend app, not this backend.
app.use(helmet());
const allowedOrigins = new Set([
  process.env.FRONTEND_URL || "http://localhost:3000",
  "http://localhost:3000",
  "http://localhost:4000",
]);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
    res.header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.header("Access-Control-Allow-Credentials", "true");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.set("trust proxy", 1); // needed for correct client IPs behind Hostinger's/any reverse proxy, which rate limiting relies on

// The Razorpay webhook needs the exact raw request bytes to verify its signature
// (see routes/billing.ts for why) — this must be mounted BEFORE the global
// express.json() below, or json() will have already consumed and parsed the body.
app.use("/api/billing/webhook", express.raw({ type: "application/json" }));

app.use(express.json({ limit: "5mb" })); // 5mb headroom for base64 screenshot uploads
app.use(generalRateLimiter);

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRateLimiter, authRouter);
app.use("/api/companies", companyRouter);
app.use("/api/decks", deckRouter);
app.use("/api/campaigns", campaignRouter);
app.use("/api/sends", sendRouter);
app.use("/api/admin", adminRouter);
app.use("/api/billing", billingRouter);
app.use("/api/email-templates", emailTemplateRouter);
app.use("/api/notifications", notificationRouter);
app.use("/api/profile", profileRouter);
app.use("/api/leads", leadsRouter);
app.use(googleAuthRouter); // mounts /auth/google/init and /auth/google/callback directly (not under /api)

// Centralized error handler — anything thrown in a route lands here instead of hanging
// the request or leaking a raw stack trace to the client.
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error." });
});

if (require.main === module) {
  const port = Number(process.env.PORT) || 4000;
  const server = app.listen(port, () => console.log(`GoPitch API listening on :${port}`));

  if (process.env.GMAIL_WATCHER_ENABLED !== "false") {
    const WATCH_INTERVAL_MS = 15 * 60 * 1000;
    const runWatcher = async () => {
      try {
        await checkGmailRepliesForAllUsers();
      } catch (err) {
        console.error("Gmail watcher error:", err);
      }
    };
    runWatcher();
    setInterval(runWatcher, WATCH_INTERVAL_MS);
    console.log(`Gmail reply watcher started (every ${WATCH_INTERVAL_MS / 1000 / 60} minutes)`);
  }

  process.on("SIGTERM", () => server.close(() => process.exit(0)));
  process.on("SIGINT", () => server.close(() => process.exit(0)));
}
