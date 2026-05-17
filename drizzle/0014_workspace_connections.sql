-- Workspace connections (multi-account, per user)
--
-- Each row is one Google Apps Script bridge the user has connected.
-- A user can have several at once (Personal / Work / Kuliah / etc).
-- Exactly one is the default — used when the assistant doesn't have an
-- account hint from the user.
--
-- The `secret_encrypted` column holds the GAS shared secret encrypted
-- with AES-GCM (key = WORKSPACE_SECRET_KEY env var). Webhook URL is
-- stored in plaintext; the URL alone cannot trigger actions without
-- the secret.
--
-- We keep this in its own table (not user_profiles) so future
-- providers (Notion, Apple Reminders, etc) can drop in without
-- bloating the profile row.

CREATE TABLE IF NOT EXISTS workspace_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  label TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'google_gas',
  webhook_url TEXT NOT NULL,
  secret_encrypted TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  connected_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  last_test_at INTEGER,
  last_test_ok INTEGER,
  last_used_at INTEGER
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_workspace_connections_user_id
  ON workspace_connections(user_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_connections_user_label
  ON workspace_connections(user_id, label);
--> statement-breakpoint
ALTER TABLE chat_sessions ADD COLUMN active_connection_ids TEXT;
