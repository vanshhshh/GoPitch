-- Add Google Sign-In linking fields to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_email TEXT;
CREATE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub);
