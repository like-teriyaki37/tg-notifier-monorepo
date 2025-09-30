-- Schema for notifier system

-- users table
CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  verified BOOLEAN NOT NULL DEFAULT false,
  chat_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- pending_links table
CREATE TABLE IF NOT EXISTS pending_links (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  chat_id BIGINT NOT NULL,
  otp_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  expires_at TIMESTAMPTZ NOT NULL,
  state TEXT NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','USED','EXPIRED','LOCKED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Useful indexes for lookups
CREATE INDEX IF NOT EXISTS idx_pending_links_email_state ON pending_links (lower(email), state);
CREATE INDEX IF NOT EXISTS idx_pending_links_chat_state ON pending_links (chat_id, state);
