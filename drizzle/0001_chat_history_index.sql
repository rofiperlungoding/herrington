-- Migration: 0001_chat_history_index
--
-- Purpose:
--   Add composite (user_id, created_at) index on ai_chat_history so loading
--   a user's chat history ordered by time leverages an index scan instead of
--   sorting the whole table.
--
-- Applied via: `npx drizzle-kit migrate` or
--              `turso db shell <db-name> < drizzle/0001_chat_history_index.sql`
-- Idempotent thanks to IF NOT EXISTS — re-running is a no-op.

CREATE INDEX IF NOT EXISTS `idx_chat_user_created` ON `ai_chat_history` (`user_id`,`created_at`);
