-- Pomodoro sessions
--
-- Append-only log of focus sessions. Each row records ONE completed
-- session attached to ONE task (or unattached, when `task_id IS NULL`,
-- for freeform focus blocks not pinned to a specific task).

CREATE TABLE IF NOT EXISTS pomodoro_sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  task_id       TEXT,
  duration_sec  INTEGER NOT NULL,
  started_at    INTEGER NOT NULL,
  completed_at  INTEGER NOT NULL,
  label         TEXT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_pomodoro_user_started
  ON pomodoro_sessions(user_id, started_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_pomodoro_task_started
  ON pomodoro_sessions(task_id, started_at);
