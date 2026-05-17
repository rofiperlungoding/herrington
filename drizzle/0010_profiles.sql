-- User profile + preferences. Single row per user.
--
-- All fields are optional; the UI provides sensible defaults when a
-- field is null. We store one row per user_id with a UNIQUE constraint
-- so upserts are simple. The row is created lazily on first profile
-- write.
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id          TEXT PRIMARY KEY,
  display_name     TEXT,
  preferred_name   TEXT,
  headline         TEXT,
  -- Single emoji used as the avatar glyph.
  avatar_emoji     TEXT,
  -- Hex color (#RRGGBB) for the avatar background ring.
  avatar_color     TEXT,
  -- Free-form location label ("Jakarta, ID") shown on dashboard.
  location_label   TEXT,
  -- Comma-separated tags (e.g. "engineering,study,research") used to
  -- prime the assistant's persona and the Dawn Protocol filter.
  focus_areas      TEXT,
  -- Theme override: 'auto' | 'light' | 'dark'.
  theme            TEXT NOT NULL DEFAULT 'auto',
  -- Accent palette key — one of the design-system accent presets.
  accent           TEXT NOT NULL DEFAULT 'default',
  -- Date format pref: '2025-05-16' | '16 May 2025' | '5/16/25'.
  date_format      TEXT NOT NULL DEFAULT 'long',
  -- Whether the dashboard should show market data tiles at all.
  show_markets     INTEGER NOT NULL DEFAULT 1,
  -- Whether the dashboard should show weather (requires geolocation).
  show_weather     INTEGER NOT NULL DEFAULT 1,
  created_at       INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at       INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
