-- Add a `summary` column to chat_sessions so the chat handler can cache
-- a rolling summary of older messages (anything outside the recent
-- context window) instead of re-summarizing every turn.
--
-- Nullable: a fresh session has no older messages, so no summary yet.
ALTER TABLE chat_sessions ADD COLUMN summary TEXT;
--> statement-breakpoint
-- Track how many messages have been folded into `summary` so we know
-- whether older messages have arrived since the last summary refresh.
-- Defaults to 0 for existing rows.
ALTER TABLE chat_sessions ADD COLUMN summary_through INTEGER NOT NULL DEFAULT 0;
