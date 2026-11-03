-- Audit hardening: payment lifecycle states, campaign/send lifecycle states, server-side
-- OAuth state storage, enterprise enquiries, and webhook idempotency. Every statement is
-- idempotent and additive (no data is deleted or rewritten), so it is safe to re-run.

-- ---------- OAuth state (replaces the in-memory Map and the JWT-as-state pattern) ----------
CREATE TABLE IF NOT EXISTS oauth_states (
  state       TEXT PRIMARY KEY,
  purpose     TEXT NOT NULL CHECK (purpose IN ('gmail_connect','gmail_confirm','signin','signin_code')),
  user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
  payload     TEXT, -- AES-256-GCM encrypted JSON when it carries tokens
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires_at ON oauth_states(expires_at);

-- ---------- Webhook idempotency (previously created lazily on every webhook call) ----------
CREATE TABLE IF NOT EXISTS processed_webhook_events (
  event_id     TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE processed_webhook_events ADD COLUMN IF NOT EXISTS event_type TEXT;

-- ---------- Enterprise / sales enquiries (previously created lazily on every submit) ----------
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT REFERENCES users(id),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT NOT NULL,
  company TEXT,
  website TEXT,
  team_size TEXT,
  outreach_volume TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'NEW',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Older deployments created a smaller leads table for the original enterprise form.
-- Add the newer columns without rewriting or deleting existing enquiries.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS company TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS website TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS team_size TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS outreach_volume TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS message TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'NEW';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check;
ALTER TABLE leads ADD CONSTRAINT leads_status_check CHECK (status IN ('NEW','CONTACTED','QUALIFIED','CLOSED'));
CREATE INDEX IF NOT EXISTS idx_leads_status_created ON leads(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_email_created ON leads(lower(email), created_at DESC);

-- ---------- Payments: distinguish initiated / paid / failed / refunded / expired ----------
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS failure_reason TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('CREATED','PAID','FAILED','REFUNDED','EXPIRED'));
CREATE INDEX IF NOT EXISTS idx_invoices_user_status ON invoices(user_id, status);

-- Which paid invoice the current subscription period came from, so a refund of that
-- invoice can end the entitlement it granted.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS source_invoice_id TEXT REFERENCES invoices(id);

-- ---------- Campaigns: FREE campaigns are real (tier was previously forced to STARTER) ----------
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_tier_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_tier_check CHECK (tier IN ('FREE','STARTER','GROWTH','ENTERPRISE'));
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_status_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_status_check CHECK (status IN ('ACTIVE','PAUSED','COMPLETED','CANCELLED'));
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ---------- Sends: cancellable, with a recorded failure reason ----------
ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS failure_reason TEXT;
ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE email_sends DROP CONSTRAINT IF EXISTS email_sends_status_check;
ALTER TABLE email_sends ADD CONSTRAINT email_sends_status_check
  CHECK (status IN ('QUEUED','SENT','REPLIED','BOUNCED','FAILED','SKIPPED_CAP_REACHED','CANCELLED'));

-- One draft per investor per campaign.
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_sends_campaign_investor ON email_sends(campaign_id, investor_id);
-- Daily-cap and quota counting reads by (user, sent_at).
CREATE INDEX IF NOT EXISTS idx_email_sends_user_sent_at ON email_sends(user_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_email_sends_user_created_at ON email_sends(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_sends_campaign_status ON email_sends(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_investors_matchable ON investors(is_verified, needs_enrichment);
CREATE INDEX IF NOT EXISTS idx_investors_firm_lower ON investors(lower(firm));
