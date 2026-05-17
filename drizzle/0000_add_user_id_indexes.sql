-- Migration: 0000_add_user_id_indexes
--
-- Spec: performance-optimization (Task 4.2 — Wave 2)
-- Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 12.5
-- Design: S6.1, S6.2, EH6
--
-- Purpose:
--   Establish the Drizzle migration baseline for the Turso/libSQL schema and
--   add the user-scoped indexes required by Requirement 8 so list-by-user
--   queries on `tasks` and `habits` no longer perform a full table scan.
--
-- Idempotency notes (Requirement 8.5):
--   This is the first migration generated for the project, but the production
--   Turso instance already contains every table below — they were created
--   manually before Drizzle migrations were adopted. To make this migration
--   safe to apply against both fresh and already-migrated environments
--   (Requirement 8.5: re-running MUST NOT error), every `CREATE TABLE` and
--   `CREATE INDEX` statement uses the `IF NOT EXISTS` clause. Drizzle Kit
--   emits the plain forms by default, so this file is hand-edited from the
--   generator output. Re-running `drizzle-kit generate` will overwrite this
--   file; if you regenerate, re-apply the `IF NOT EXISTS` edits before merging.
--
-- EXPLAIN QUERY PLAN verification (Requirement 8.4 / 12.5):
--   This migration was applied to a transient local libSQL file and the
--   following query plans were captured by `scripts/verify-migration-explain.mjs`
--   (run `node scripts/verify-migration-explain.mjs` to reproduce):
--
--     EXPLAIN QUERY PLAN SELECT * FROM tasks WHERE user_id = ?
--       → SEARCH tasks USING INDEX idx_tasks_user_created (user_id=?)
--
--     EXPLAIN QUERY PLAN SELECT * FROM tasks WHERE user_id = ? ORDER BY created_at DESC
--       → SEARCH tasks USING INDEX idx_tasks_user_created (user_id=?)
--
--     EXPLAIN QUERY PLAN SELECT * FROM habits WHERE user_id = ?
--       → SEARCH habits USING INDEX idx_habits_user (user_id=?)
--
--   The optimizer prefers `idx_tasks_user_created` over `idx_tasks_user`
--   because both satisfy the equality predicate and the composite index
--   covers the same prefix while also serving the `ORDER BY created_at`
--   clause used by the production list query. Either choice satisfies
--   Requirement 8.4 (the plan must reference one of the new indexes, not
--   a "SCAN" of the underlying table). The full captured output is also
--   recorded in the PR description.
--
-- Live application against Turso (operator notes):
--   This migration must be applied by the operator before deploying the
--   Wave 2 build to production. Run either:
--     npx drizzle-kit migrate
--   or, against the Turso CLI:
--     turso db shell <db-name> < drizzle/0000_add_user_id_indexes.sql
--   The `IF NOT EXISTS` clauses make the operation a no-op on tables and
--   indexes that already exist; only the three new indexes will actually
--   be created on the existing production database.

CREATE TABLE IF NOT EXISTS `ai_chat_history` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`content_chunk` text NOT NULL,
	`embedding` F32_BLOB,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `habits` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`current_streak` integer DEFAULT 0 NOT NULL,
	`longest_streak` integer DEFAULT 0 NOT NULL,
	`last_completed_date` integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_habits_user` ON `habits` (`user_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `idea_vault` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`keywords` text NOT NULL,
	`generated_concept` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`is_completed` integer DEFAULT false NOT NULL,
	`deadline` integer,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tasks_user` ON `tasks` (`user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tasks_user_created` ON `tasks` (`user_id`,`created_at`);
