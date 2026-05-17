-- Migration: 0003_task_reschedule_count
--
-- Purpose:
--   Track how many consecutive times a task has been pushed forward via
--   the "reschedule to tomorrow" action. The frontend uses this counter
--   to surface an AI-flavored nudge after the third reschedule in a row.
--
-- Resets to 0 when:
--   - The task is completed.
--   - The deadline is moved earlier via PATCH /api/tasks/:id (server logic).
--
-- Idempotent on re-runs because drizzle's _journal.json gates this file.

ALTER TABLE `tasks` ADD COLUMN `reschedule_count` integer NOT NULL DEFAULT 0;
