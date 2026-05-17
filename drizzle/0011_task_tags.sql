-- Task tags
--
-- Adds a free-form tags column to `tasks`. Tags are a comma-separated list
-- of short labels (e.g. "kuliah,urgent") that augment the existing single
-- `category` field with multi-axis context.
--
-- Storage choice: a comma-separated TEXT column instead of a join table.
--   - Tasks have only a handful of tags each; full normalisation would be
--     overkill at this scale.
--   - Filtering is done in JS after the row arrives — `vector_top_k` style
--     server-side filtering is unnecessary for the dataset size.
--   - Future migration to a proper tag table is trivial: split on `,`
--     and INSERT into `task_tags(task_id, tag)`.
--
-- The column is NOT NULL with a default of '' so existing rows automatically
-- carry an empty tag list and downstream JOINs / WHEREs don't have to special
-- case NULL.

ALTER TABLE tasks ADD COLUMN tags TEXT NOT NULL DEFAULT '';
