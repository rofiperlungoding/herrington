-- NotebookLM mode tables.
--
-- Each user has multiple notebooks. Each notebook holds multiple
-- source files. Each file is split into chunks; each chunk is one
-- row in the `documents` table with its own embedding so vector
-- search can find the closest chunks across all of a notebook's
-- files at once.
--
-- We *extend* the existing `documents` table rather than replacing
-- it so older rows (if any) keep working. New columns are nullable
-- with sensible defaults.

CREATE TABLE IF NOT EXISTS notebooks (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT,
  created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_notebooks_user_updated
  ON notebooks(user_id, updated_at);
--> statement-breakpoint

-- One row per uploaded file (the "source"). Chunks live in `documents`
-- and reference back via `source_id`. Storing the source file
-- separately means the user can delete a file and we cascade-delete
-- all its chunks.
CREATE TABLE IF NOT EXISTS notebook_sources (
  id           TEXT PRIMARY KEY,
  notebook_id  TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  filename     TEXT NOT NULL,
  mime_type    TEXT,
  /** Original byte-size of the file before text extraction. */
  size_bytes   INTEGER,
  /** Char count of the extracted plain text — useful for sanity checks. */
  text_length  INTEGER,
  /** Total chunks emitted for this source. */
  chunk_count  INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_notebook_sources_notebook
  ON notebook_sources(notebook_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_notebook_sources_user
  ON notebook_sources(user_id);
--> statement-breakpoint

-- Extend `documents` with notebook + source linkage and chunk
-- metadata. Existing rows have NULL for these — they're treated as
-- "orphan" chunks invisible to the new UI.
ALTER TABLE documents ADD COLUMN notebook_id TEXT;
--> statement-breakpoint
ALTER TABLE documents ADD COLUMN source_id   TEXT;
--> statement-breakpoint
ALTER TABLE documents ADD COLUMN chunk_index INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_documents_notebook
  ON documents(notebook_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_documents_source
  ON documents(source_id);
