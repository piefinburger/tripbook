CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS login_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  invite_trip_id BIGINT,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS trips (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  start_date DATE,
  end_date DATE,
  owner_id BIGINT NOT NULL REFERENCES users(id),
  cover_photo_id BIGINT,
  invite_code TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS trip_members (
  trip_id BIGINT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  PRIMARY KEY (trip_id, user_id)
);
CREATE TABLE IF NOT EXISTS entries (
  id BIGSERIAL PRIMARY KEY,
  trip_id BIGINT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id),
  client_id TEXT UNIQUE,
  ts TIMESTAMPTZ NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  lat DOUBLE PRECISION, lng DOUBLE PRECISION,
  place_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS entries_trip_ts ON entries(trip_id, ts);
CREATE TABLE IF NOT EXISTS photos (
  id BIGSERIAL PRIMARY KEY,
  trip_id BIGINT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  entry_id BIGINT REFERENCES entries(id) ON DELETE SET NULL,
  user_id BIGINT NOT NULL REFERENCES users(id),
  s3_key TEXT NOT NULL,
  preview_key TEXT,
  width INT, height INT,
  ts TIMESTAMPTZ NOT NULL,
  lat DOUBLE PRECISION, lng DOUBLE PRECISION,
  place_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS photos_trip_ts ON photos(trip_id, ts);
CREATE TABLE IF NOT EXISTS book_exports (
  id BIGSERIAL PRIMARY KEY,
  trip_id BIGINT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('auto','curated')),
  status TEXT NOT NULL DEFAULT 'generating'
    CHECK (status IN ('generating','preview','rendering','done','error')),
  layout_spec JSONB,
  error TEXT,
  pdf_s3_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE trips DROP CONSTRAINT IF EXISTS trips_cover_fk;
ALTER TABLE trips ADD CONSTRAINT trips_cover_fk
  FOREIGN KEY (cover_photo_id) REFERENCES photos(id) ON DELETE SET NULL;

-- Book editor (SPEC-BOOK-EDITOR)
CREATE TABLE IF NOT EXISTS book_drafts (
  id BIGSERIAL PRIMARY KEY,
  trip_id BIGINT NOT NULL UNIQUE REFERENCES trips(id) ON DELETE CASCADE,
  spec JSONB NOT NULL,
  mode TEXT NOT NULL DEFAULT 'auto',
  status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','generating','error')),
  error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS book_draft_revisions (
  id BIGSERIAL PRIMARY KEY,
  draft_id BIGINT NOT NULL REFERENCES book_drafts(id) ON DELETE CASCADE,
  spec JSONB NOT NULL,
  source TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bdr_draft ON book_draft_revisions(draft_id, id DESC);
ALTER TABLE book_exports ADD COLUMN IF NOT EXISTS draft_id BIGINT REFERENCES book_drafts(id);

-- AI settings (SPEC-AI-SETTINGS)
CREATE TABLE IF NOT EXISTS user_settings (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  openrouter_key_enc BYTEA,
  openrouter_key_last4 TEXT,
  routing JSONB NOT NULL DEFAULT '{}',
  curation_level TEXT NOT NULL DEFAULT 'balanced'
    CHECK (curation_level IN ('everything','balanced','highlights')),
  best_pictures_enabled BOOLEAN NOT NULL DEFAULT false,
  transcribe_polish_enabled BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS prompt_overrides (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task TEXT NOT NULL,
  block TEXT NOT NULL,
  content TEXT NOT NULL,
  PRIMARY KEY (user_id, task, block)
);
CREATE TABLE IF NOT EXISTS prompt_revisions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  task TEXT NOT NULL, block TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE photos ADD COLUMN IF NOT EXISTS quality INT;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS vision_tags TEXT[];
ALTER TABLE photos ADD COLUMN IF NOT EXISTS dup_group TEXT;

-- Gallery (SPEC-GALLERY)
ALTER TABLE photos ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'photo'
  CHECK (kind IN ('photo','video'));
ALTER TABLE photos ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'capture'
  CHECK (source IN ('capture','library'));
ALTER TABLE photos ADD COLUMN IF NOT EXISTS duration_s INT;

-- Trip roles: constraint is defined ONCE below (viewer block). Never add a
-- second drop/recreate of the same constraint: schema.sql re-applies in full
-- on every boot, and a stale narrower version will reject live rows.

-- Viewer role (read-only family members, e.g. grandparents)
ALTER TABLE trip_members DROP CONSTRAINT IF EXISTS trip_members_role_check;
ALTER TABLE trip_members ADD CONSTRAINT trip_members_role_check
  CHECK (role IN ('owner','admin','member','viewer'));
ALTER TABLE login_tokens ADD COLUMN IF NOT EXISTS invite_role TEXT DEFAULT 'member';

-- Last-active tracking for the Trip Settings member list
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;
