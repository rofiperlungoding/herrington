-- NotebookLM mode: persistent Q&A and unified sources.
--
-- Two changes:
--
-- 1. `notebook_sources` gets a `kind` column ('file' | 'web') and a
--    nullable `url` column. Web search results captured during a
--    research turn are stored as 'web' sources alongside file uploads
--    so the UI can show them in one panel.
--
-- 2. New `notebook_messages` table stores the Q&A conversation per
--    notebook (mirrors chat history). Citations are stored as JSON
--    on each assistant message — same shape the client already
--    consumes via the inline dropdown.

ALTER TABLE notebook_sources ADD COLUMN kind TEXT NOT NULL DEFAULT 'file';
--> statement-breakpoint
ALTER TABLE notebook_sources ADD COLUMN url TEXT;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS notebook_messages (
  id          TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  role        TEXT NOT NULL,      -- 'user' | 'assistant'
  content     TEXT NOT NULL,
  -- JSON-encoded array of { sourceId, chunkIndex, snippet, sourceFilename }
  citations   TEXT,
  created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_notebook_messages_notebook_created
  ON notebook_messages(notebook_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_notebook_messages_user
  ON notebook_messages(user_id);
