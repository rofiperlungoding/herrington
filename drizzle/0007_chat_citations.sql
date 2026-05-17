-- Add a `citations` column to ai_chat_history so assistant messages
-- backed by web-search tool calls can carry their source URLs alongside
-- the message content. Stored as a JSON-encoded array of
-- { title, url, snippet }.
--
-- Nullable: most messages don't have citations.
ALTER TABLE ai_chat_history ADD COLUMN citations TEXT;
