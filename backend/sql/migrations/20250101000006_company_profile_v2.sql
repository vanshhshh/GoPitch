-- Company profile v2: richer onboarding, co-founders, AI intelligence, matching v2,
-- saved/excluded investors, draft campaigns. Additive and idempotent; existing
-- companies are marked as onboarded so current founders are never sent back through
-- onboarding.

-- ---------- Companies: drafts can exist before every field is known ----------
ALTER TABLE companies ALTER COLUMN one_liner DROP NOT NULL;
ALTER TABLE companies ALTER COLUMN problem DROP NOT NULL;
ALTER TABLE companies ALTER COLUMN solution DROP NOT NULL;
ALTER TABLE companies ALTER COLUMN ask_amount_usd DROP NOT NULL;
ALTER TABLE companies ALTER COLUMN stage DROP NOT NULL;

ALTER TABLE companies ADD COLUMN IF NOT EXISTS website TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS founded_year INTEGER;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS headquarters TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS sub_industry TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS business_type TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS target_customer TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS existing_alternatives TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS competitive_advantage TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS competitors TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS product_stage TEXT;
ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_product_stage_check;
ALTER TABLE companies ADD CONSTRAINT companies_product_stage_check
  CHECK (product_stage IS NULL OR product_stage IN ('IDEA','PROTOTYPE','MVP','LAUNCHED','SCALING'));
-- Free-form but validated sections (zod schemas in services/companyProfileSchema.ts).
ALTER TABLE companies ADD COLUMN IF NOT EXISTS product_market JSONB NOT NULL DEFAULT '{}';
-- NB: companies.traction already exists as the v1 free-text traction note and is kept
-- (surfaced as the "Traction summary" answer); structured metrics get their own column.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS traction_metrics JSONB NOT NULL DEFAULT '{}';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS fundraising JSONB NOT NULL DEFAULT '{}';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS investor_preferences JSONB NOT NULL DEFAULT '{}';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS documents JSONB NOT NULL DEFAULT '{}';
-- Founder opt-in before any financial figure is sent to a third-party AI provider.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS ai_financials_consent BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS onboarding_step INTEGER NOT NULL DEFAULT 0;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Backward compatibility: companies created by the old flow are complete profiles.
UPDATE companies SET onboarding_completed_at = created_at, onboarding_step = 7
WHERE onboarding_completed_at IS NULL AND one_liner IS NOT NULL AND problem IS NOT NULL AND ask_amount_usd IS NOT NULL AND stage IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = '__v2_backfilled');
ALTER TABLE companies ADD COLUMN IF NOT EXISTS __v2_backfilled BOOLEAN NOT NULL DEFAULT true;

-- ---------- Co-founders (profiles, not logins) ----------
CREATE TABLE IF NOT EXISTS company_founders (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  company_id          TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id             TEXT REFERENCES users(id) ON DELETE SET NULL,
  full_name           TEXT NOT NULL,
  role                TEXT,
  linkedin_url        TEXT,
  location            TEXT,
  education           TEXT,
  experience          TEXT,
  previous_companies  TEXT,
  domain_expertise    TEXT[] NOT NULL DEFAULT '{}',
  skills              TEXT[] NOT NULL DEFAULT '{}',
  previous_founder    BOOLEAN,
  motivation          TEXT,
  unique_insight      TEXT,
  commitment          TEXT CHECK (commitment IS NULL OR commitment IN ('FULL_TIME','PART_TIME')),
  position            INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_company_founders_company ON company_founders(company_id, position);
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_founders_user ON company_founders(company_id, user_id) WHERE user_id IS NOT NULL;

-- Existing companies get the account holder as their first founder, carrying over the v1
-- founder_background text so nothing the founder wrote is lost.
INSERT INTO company_founders (company_id, user_id, full_name, experience, position)
SELECT c.id, c.user_id, COALESCE(NULLIF(u.name, ''), split_part(u.email, '@', 1)), c.founder_background, 0
FROM companies c JOIN users u ON u.id = c.user_id
WHERE NOT EXISTS (SELECT 1 FROM company_founders f WHERE f.company_id = c.id);

-- ---------- AI company & founder intelligence ----------
-- `generated` is the model output (with provenance per field); `edited` holds the
-- founder's corrections. Neither ever overwrites the founder-entered company fields.
CREATE TABLE IF NOT EXISTS company_ai_profiles (
  company_id    TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','CONFIRMED')),
  generated     JSONB NOT NULL DEFAULT '{}',
  edited        JSONB NOT NULL DEFAULT '{}',
  provider      TEXT,
  input_hash    TEXT,
  generated_at  TIMESTAMPTZ,
  confirmed_at  TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Saved / excluded investors (per company) ----------
CREATE TABLE IF NOT EXISTS company_investor_lists (
  company_id   TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  investor_id  TEXT NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
  list         TEXT NOT NULL CHECK (list IN ('SAVED','EXCLUDED')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, investor_id)
);

-- ---------- Matching weights (admin-configurable, validated to sum to 100) ----------
CREATE TABLE IF NOT EXISTS matching_config (
  id          TEXT PRIMARY KEY,
  weights     JSONB NOT NULL,
  updated_by  TEXT REFERENCES users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Investor enrichment fields used by matching v2 ----------
ALTER TABLE investors ADD COLUMN IF NOT EXISTS investor_type TEXT;
ALTER TABLE investors DROP CONSTRAINT IF EXISTS investors_investor_type_check;
ALTER TABLE investors ADD CONSTRAINT investors_investor_type_check
  CHECK (investor_type IS NULL OR investor_type IN ('VC','MICRO_VC','ANGEL','ANGEL_NETWORK','CVC','ACCELERATOR','FAMILY_OFFICE','SYNDICATE','OTHER'));
ALTER TABLE investors ADD COLUMN IF NOT EXISTS sub_sectors TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE investors ADD COLUMN IF NOT EXISTS business_models TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE investors ADD COLUMN IF NOT EXISTS leads_rounds BOOLEAN;
ALTER TABLE investors ADD COLUMN IF NOT EXISTS fund_status TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE investors DROP CONSTRAINT IF EXISTS investors_fund_status_check;
ALTER TABLE investors ADD CONSTRAINT investors_fund_status_check CHECK (fund_status IN ('ACTIVE','NOT_INVESTING','UNKNOWN'));
ALTER TABLE investors ADD COLUMN IF NOT EXISTS traction_requirement TEXT;
ALTER TABLE investors DROP CONSTRAINT IF EXISTS investors_traction_requirement_check;
ALTER TABLE investors ADD CONSTRAINT investors_traction_requirement_check
  CHECK (traction_requirement IS NULL OR traction_requirement IN ('PRE_REVENUE_OK','REVENUE_REQUIRED'));
ALTER TABLE investors ADD COLUMN IF NOT EXISTS founder_preferences TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE investors ADD COLUMN IF NOT EXISTS fund_description TEXT;

-- ---------- Draft campaigns ----------
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_status_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_status_check CHECK (status IN ('DRAFT','ACTIVE','PAUSED','COMPLETED','CANCELLED'));
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS launched_at TIMESTAMPTZ;
UPDATE campaigns SET launched_at = created_at WHERE launched_at IS NULL AND status <> 'DRAFT';
