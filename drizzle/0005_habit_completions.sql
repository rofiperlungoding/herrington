-- Migration: 0005_habit_completions
--
-- Purpose:
--   Persist every successful check-off as its own row so the heatmap UI
--   can render a GitHub-style grid of the last N days. Without this
--   table the only history we kept was a single `lastCompletedDate`
--   column, which is not enough to draw a multi-day grid.
--
-- Schema notes:
--   - `date` is stored as days-since-unix-epoch (a small integer), not
--     a timestamp. The check-off endpoint computes it from the user's
--     Local_Today at the moment of the check-off, so two check-offs on
--     the same local calendar day always collide on the same
--     (habit_id, date) pair.
--   - We don't add a UNIQUE constraint on (habit_id, date) because
--     SQLite/libSQL forbids ALTER TABLE for that and the application
--     deduplicates via INSERT OR IGNORE.
--
-- Idempotent on re-runs because drizzle's _journal.json gates this file.

CREATE TABLE IF NOT EXISTS `habit_completions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`habit_id` text NOT NULL,
	`date` integer NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_habit_completions_habit_date`
  ON `habit_completions` (`habit_id`, `date`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_habit_completions_user`
  ON `habit_completions` (`user_id`);
