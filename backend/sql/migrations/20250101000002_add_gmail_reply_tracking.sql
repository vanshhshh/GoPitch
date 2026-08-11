-- Add Gmail thread tracking and reply detection fields
ALTER TABLE email_sends
  ADD COLUMN IF NOT EXISTS gmail_thread_id TEXT,
  ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ;

ALTER TABLE email_sends
  DROP CONSTRAINT IF EXISTS email_sends_status_check;

ALTER TABLE email_sends
  ADD CONSTRAINT email_sends_status_check
  CHECK (status IN ('QUEUED','SENT','REPLIED','BOUNCED','FAILED','SKIPPED_CAP_REACHED'));

CREATE INDEX IF NOT EXISTS idx_email_sends_gmail_thread_id ON email_sends(gmail_thread_id);
CREATE INDEX IF NOT EXISTS idx_email_sends_user_id_status ON email_sends(user_id, status);
