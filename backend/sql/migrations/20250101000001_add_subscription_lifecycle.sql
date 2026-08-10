-- Add subscription lifecycle tracking fields
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS current_period_start TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
