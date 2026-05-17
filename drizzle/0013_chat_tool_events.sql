-- Chat tool events
--
-- Adds a JSON-encoded `tool_events` column to `ai_chat_history` so the
-- frontend can render structured Gemini-style cards (Calendar events,
-- email lists, Doc creation confirmations) instead of plain markdown.
--
-- Each event captures one tool invocation:
--   { kind, status, args, data, error }
-- where `kind` is the tool name (web_search / list_unread_emails /
-- check_calendar_availability / create_calendar_event / create_doc),
-- `status` is 'success' | 'error', `args` is the request payload as
-- the AI sent it, `data` is the upstream response payload, and `error`
-- carries a user-friendly reason on failure.
--
-- Stored as TEXT (CSV/JSON pattern used elsewhere in this schema) so
-- existing rows without events read as NULL and clients fall back to
-- the legacy citations-only render.

ALTER TABLE ai_chat_history ADD COLUMN tool_events TEXT;
