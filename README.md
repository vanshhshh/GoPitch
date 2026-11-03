# GoPitch

Fundraising SaaS for founders: company profile → pitch deck (upload, or AI-generated on paid
plans) → scored investor matching → personalized outreach sent from the founder's own Gmail.

- `frontend/` — Next.js 14 (App Router), Tailwind. Talks to the API with a bearer token.
- `backend/` — Express 5 + node-postgres (hand-written SQL). `prisma/schema.prisma` is
  documentation only; `sql/schema.sql` + `sql/migrations/` are what runs.

## Run locally

```bash
cd backend
npm install
cp .env.example .env          # fill in values
psql "$DATABASE_URL" -f sql/schema.sql   # fresh database only
npm run migrate               # applies sql/migrations in order (idempotent)
npm run dev                   # :4000

cd ../frontend
npm install
echo "NEXT_PUBLIC_API_BASE=http://localhost:4000" > .env.local
npm run dev                   # :3000
```

Create an admin: `npx tsx scripts/makeAdmin.ts <email> <password>` (choose a fresh password;
never commit it).

## Tests

```bash
cd backend
npm test                      # unit + integration (integration runs on in-process Postgres/PGlite)
npm run typecheck
```

Integration tests apply `schema.sql` and every migration to a throwaway in-memory Postgres,
then drive the real HTTP API. AI, Gmail delivery and Razorpay's API are mocked; Razorpay
webhooks are signed with a test secret. No real email or payment ever happens.

Local end-to-end (browser) run: `npm run e2e:server` starts the real API on :4100 with seeded
investors and stubbed AI/Gmail, then `NEXT_PUBLIC_API_BASE=http://localhost:4100 npx next dev -p 3100`
in `frontend/`.

## Business rules (enforced in the backend)

| Plan | Price | Outreach emails | Active campaigns |
|---|---|---|---|
| Free | ₹0 | 30 (lifetime) | 1 |
| Starter | ₹4,499 one-time | 100 per purchase | unlimited |
| Growth | ₹11,999 / month | 500 per 30-day period | unlimited |
| Enterprise | Custom quote (typically from ₹30,000–₹35,000) | configurable | configurable |

Sending, every plan: 50 emails/day for the first 3 days after Gmail is connected, then
150/day. The daily count resets at 00:00 UTC (05:30 IST). Dispatch is serialized per user
with a Postgres advisory lock so concurrent requests can't exceed either limit.

A plan is only activated after the server confirms a captured payment (Razorpay webhook,
or the post-checkout verify call, which fetches the payment from Razorpay).

## Production checklist

See the audit report for the full list. Minimum:

1. `npm run migrate` against production (additive, idempotent migration `20250101000005_audit_hardening.sql`).
2. Razorpay Dashboard → Webhooks: URL `https://<api>/api/billing/webhook`, events
   `payment.captured`, `order.paid`, `payment.failed`, `refund.processed`; secret = `RAZORPAY_WEBHOOK_SECRET`.
3. Google Cloud OAuth client: authorized redirect URIs `<api>/auth/google/callback` and
   `<api>/auth/google/signin/callback`; consent screen scopes `gmail.send`, `gmail.metadata`,
   `userinfo.email`, `openid`, `email`, `profile` (restricted scopes require Google verification).
4. `FRONTEND_URL` set to the exact production origin(s); `NODE_ENV=production`.
5. Rotate any credential that was ever pasted into chat or committed (including the admin
   password that appeared in an earlier version of this README).
