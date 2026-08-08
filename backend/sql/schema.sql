-- Pitch-OS schema. Mirrors prisma/schema.prisma exactly (kept as the documented data
-- model). This file is what actually runs, via node-postgres, because Prisma's engine
-- binary download is blocked in this sandbox's network policy (binaries.prisma.sh isn't
-- on the allowlist). On your VPS, where full network access exists, you can switch to
-- `npx prisma migrate deploy` using the same schema.prisma with zero model changes —
-- this SQL is a 1:1 translation, not a divergent implementation.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email                 TEXT UNIQUE NOT NULL,
  password_hash         TEXT,
  name                  TEXT,
  role                  TEXT NOT NULL DEFAULT 'FOUNDER' CHECK (role IN ('FOUNDER','ADMIN')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  google_access_token   TEXT,
  google_refresh_token  TEXT,
  google_token_expiry   TIMESTAMPTZ,
  gmail_connected_at    TIMESTAMPTZ,
  connected_gmail_address TEXT, -- may differ from login email

  send_reputation_score REAL NOT NULL DEFAULT 1.0,
  account_age_days      INTEGER NOT NULL DEFAULT 0,
  complaint_reported_at TIMESTAMPTZ
);

CREATE TABLE companies (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id             TEXT NOT NULL REFERENCES users(id),
  name                TEXT NOT NULL,
  one_liner           TEXT NOT NULL,
  problem             TEXT NOT NULL,
  solution            TEXT NOT NULL,
  stage               TEXT NOT NULL CHECK (stage IN ('IDEA','PRE_SEED','SEED','SERIES_A','SERIES_B_PLUS')),
  sector              TEXT[] NOT NULL DEFAULT '{}',
  geography           TEXT[] NOT NULL DEFAULT '{}',
  ask_amount_usd      INTEGER NOT NULL,
  traction            TEXT,
  founder_background  TEXT,
  screenshot_urls     TEXT[] NOT NULL DEFAULT '{}',
  extracted_keywords  TEXT[] NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE decks (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  version       INTEGER NOT NULL DEFAULT 1,
  source        TEXT NOT NULL DEFAULT 'generated' CHECK (source IN ('generated','uploaded')),
  sections_json JSONB, -- present when source = 'generated'
  uploaded_file_path TEXT, -- present when source = 'uploaded'
  uploaded_file_type TEXT, -- 'pptx' | 'pdf'
  uploaded_file_name TEXT,
  pdf_url       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE investors (
  id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name                  TEXT NOT NULL,
  firm                  TEXT NOT NULL,
  email                 TEXT UNIQUE NOT NULL,
  title                 TEXT,
  linkedin_url          TEXT,
  website               TEXT,
  source                TEXT, -- where this contact came from (apollo, manual, referral, etc.)
  stage_focus           TEXT[] NOT NULL DEFAULT '{}',
  sector_focus          TEXT[] NOT NULL DEFAULT '{}',
  geo_focus             TEXT[] NOT NULL DEFAULT '{}',
  check_size_min_usd    INTEGER,
  check_size_max_usd    INTEGER,
  thesis_keywords       TEXT[] NOT NULL DEFAULT '{}',
  portfolio_companies   TEXT[] NOT NULL DEFAULT '{}',
  last_known_active_at  TIMESTAMPTZ,
  source_verified_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_verified           BOOLEAN NOT NULL DEFAULT false,
  needs_enrichment      BOOLEAN NOT NULL DEFAULT false, -- true when imported with no stage/sector/geo data
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE investor_warmth (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  investor_id  TEXT NOT NULL REFERENCES investors(id),
  user_id      TEXT NOT NULL REFERENCES users(id),
  status       TEXT NOT NULL CHECK (status IN ('COLD','REPLIED_INTERESTED','REPLIED_PASS','REPLIED_NEEDS_INFO','MEETING_BOOKED')),
  note         TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (investor_id, user_id)
);

CREATE TABLE campaigns (
  id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id               TEXT NOT NULL REFERENCES users(id),
  company_id            TEXT NOT NULL REFERENCES companies(id),
  tier                  TEXT NOT NULL CHECK (tier IN ('STARTER','GROWTH','ENTERPRISE')),
  matched_investor_ids  TEXT[] NOT NULL DEFAULT '{}',
  status                TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED','COMPLETED')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE email_sends (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  campaign_id      TEXT NOT NULL REFERENCES campaigns(id),
  user_id          TEXT NOT NULL REFERENCES users(id),
  investor_id      TEXT NOT NULL REFERENCES investors(id),
  subject          TEXT NOT NULL,
  body_text        TEXT NOT NULL,
  match_score      REAL NOT NULL,
  status           TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','SENT','BOUNCED','FAILED','SKIPPED_CAP_REACHED')),
  scheduled_for    TIMESTAMPTZ NOT NULL,
  sent_at          TIMESTAMPTZ,
  bounced_at       TIMESTAMPTZ,
  gmail_message_id TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
  id                        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id                   TEXT UNIQUE NOT NULL REFERENCES users(id),
  tier                      TEXT NOT NULL CHECK (tier IN ('STARTER','GROWTH','ENTERPRISE')),
  razorpay_subscription_id  TEXT,
  status                    TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAST_DUE','CANCELLED')),
  current_period_end        TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE invoices (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id           TEXT NOT NULL REFERENCES users(id),
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  tier              TEXT NOT NULL,
  amount_inr        INTEGER NOT NULL,
  status            TEXT NOT NULL DEFAULT 'CREATED' CHECK (status IN ('CREATED','PAID','FAILED','REFUNDED')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE email_templates (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id     TEXT NOT NULL REFERENCES users(id),
  name        TEXT NOT NULL,
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  is_default  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id     TEXT NOT NULL REFERENCES users(id),
  type        TEXT NOT NULL, -- 'campaign_created' | 'send_dispatched' | 'bounce' | 'complaint' | 'payment' | 'investor_reply'
  title       TEXT NOT NULL,
  body        TEXT,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE support_messages (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id     TEXT REFERENCES users(id),
  email       TEXT NOT NULL,
  subject     TEXT NOT NULL,
  message     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_companies_user_id ON companies(user_id);
CREATE INDEX idx_decks_company_id ON decks(company_id);
CREATE INDEX idx_campaigns_user_id ON campaigns(user_id);
CREATE INDEX idx_email_sends_campaign_id ON email_sends(campaign_id);
CREATE INDEX idx_email_sends_user_id ON email_sends(user_id);
CREATE INDEX idx_investor_warmth_user_id ON investor_warmth(user_id);
CREATE INDEX idx_investors_verified ON investors(is_verified);
CREATE INDEX idx_investors_needs_enrichment ON investors(needs_enrichment);
CREATE INDEX idx_invoices_user_id ON invoices(user_id);
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_email_templates_user_id ON email_templates(user_id);
