-- Migration: 0004_habit_kind
--
-- Purpose:
--   Distinguish recurring daily habits from one-time goals on the same row.
--   - 'daily':    classic habit, check off resets at midnight, streak applies.
--   - 'one_time': single goal, check off → row gets deleted after the
--                 countdown finishes (frontend triggers the DELETE).
--
-- Defaults to 'daily' so existing rows keep their current behaviour.
-- Idempotent on re-runs because drizzle's _journal.json gates this file.

ALTER TABLE `habits` ADD COLUMN `kind` text NOT NULL DEFAULT 'daily';
