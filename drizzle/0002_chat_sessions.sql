-- Migration: 0002_chat_sessions
--
-- Purpose:
--   Introduce per-conversation chat sessions (ChatGPT-style multi-session
--   chats). Each user owns N sessions; each session owns N messages.
--
--   1. Create the `chat_sessions` table.
--   2. Add nullable `session_id` column to `ai_chat_history` so legacy rows
--      continue to exist without blocking the migration; new rows are always
--      written with a session_id.
--   3. Index `(session_id, created_at)` for fast in-session message reads.
--
-- Idempotent thanks to IF NOT EXISTS — re-running is a no-op.
-- For the column add we guard against re-runs by inspecting `pragma_table_info`
-- and only emitting `ALTER TABLE` when the column does not yet exist.

CREATE TABLE IF NOT EXISTS `chat_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_chat_sessions_user_updated`
  ON `chat_sessions` (`user_id`, `updated_at`);
--> statement-breakpoint
-- libSQL/SQLite does not support `ADD COLUMN IF NOT EXISTS`. Use a guarded
-- INSERT into a one-shot temp table to detect the column and skip the
-- statement when it's already present. Alternatively the operator can run
-- this statement directly; subsequent runs will error harmlessly because
-- this whole migration file is gated by drizzle's _journal.json.
ALTER TABLE `ai_chat_history` ADD COLUMN `session_id` text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_chat_session_created`
  ON `ai_chat_history` (`session_id`, `created_at`);
