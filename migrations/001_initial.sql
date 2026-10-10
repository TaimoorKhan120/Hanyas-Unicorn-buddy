-- Hanya's Unicorn Buddy — initial schema. See docs/01-architecture.md for rationale.

CREATE TABLE parent_accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE parent_sessions (
  token_hash text PRIMARY KEY,
  parent_id  uuid NOT NULL REFERENCES parent_accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

CREATE TABLE child_profiles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id    uuid NOT NULL REFERENCES parent_accounts(id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 40),
  age          int  NOT NULL CHECK (age BETWEEN 3 AND 18),
  birthday     date,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE parent_settings (
  child_id                 uuid PRIMARY KEY REFERENCES child_profiles(id) ON DELETE CASCADE,
  memory_enabled           boolean NOT NULL DEFAULT true,
  retain_transcripts       boolean NOT NULL DEFAULT false,
  transcript_retention_days int    NOT NULL DEFAULT 7 CHECK (transcript_retention_days BETWEEN 1 AND 90),
  show_transcript          boolean NOT NULL DEFAULT false,
  daily_limit_minutes      int     NOT NULL DEFAULT 30 CHECK (daily_limit_minutes BETWEEN 1 AND 240),
  max_session_minutes      int     NOT NULL DEFAULT 15 CHECK (max_session_minutes BETWEEN 1 AND 120),
  quiet_start              text    CHECK (quiet_start ~ '^[0-2][0-9]:[0-5][0-9]$'),
  quiet_end                text    CHECK (quiet_end   ~ '^[0-2][0-9]:[0-5][0-9]$'),
  timezone                 text    NOT NULL DEFAULT 'UTC',
  activities               jsonb   NOT NULL DEFAULT '{}'::jsonb,
  voice                    jsonb   NOT NULL DEFAULT '{}'::jsonb,
  safety_alerts            text    NOT NULL DEFAULT 'category_only' CHECK (safety_alerts IN ('category_only', 'off')),
  birthday_celebration     boolean NOT NULL DEFAULT true
);

CREATE TABLE child_devices (
  token_hash   text PRIMARY KEY,
  child_id     uuid NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  label        text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz
);

CREATE TABLE stage_history (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id       uuid NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  stage_id       text NOT NULL,
  config_version int  NOT NULL,
  status         text NOT NULL CHECK (status IN ('proposed', 'active', 'rejected', 'superseded')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  decided_at     timestamptz
);
-- At most one active stage per child, enforced by the database.
CREATE UNIQUE INDEX stage_history_one_active ON stage_history (child_id) WHERE status = 'active';

CREATE TABLE conversation_sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id          uuid NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  character_version int  NOT NULL,
  stage_id          text NOT NULL,
  started_at        timestamptz NOT NULL DEFAULT now(),
  last_turn_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversation_sessions_child ON conversation_sessions (child_id, last_turn_at DESC);

CREATE TABLE conversation_turns (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES conversation_sessions(id) ON DELETE CASCADE,
  child_id   uuid NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('child', 'unicorn')),
  text       text NOT NULL,
  sensitive  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversation_turns_session ON conversation_turns (session_id, created_at);

CREATE TABLE memory_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id          uuid NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  category          text NOT NULL CHECK (category IN (
                      'preference', 'interest', 'story', 'game', 'achievement', 'communication', 'milestone')),
  content           text NOT NULL CHECK (length(content) BETWEEN 1 AND 200),
  provenance        text NOT NULL CHECK (provenance IN ('child_said', 'parent_added', 'inferred', 'pretend_play')),
  confidence        real CHECK (confidence BETWEEN 0 AND 1),
  source_session_id uuid REFERENCES conversation_sessions(id) ON DELETE SET NULL,
  in_scrapbook      boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  last_retrieved_at timestamptz,
  expires_at        timestamptz,
  -- An inference must carry a confidence; nothing else may.
  CHECK ((provenance = 'inferred') = (confidence IS NOT NULL))
);
CREATE INDEX memory_items_child ON memory_items (child_id, updated_at DESC);

CREATE TABLE memory_deletion_records (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id   uuid NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  memory_id  uuid,          -- NULL when scope = 'all'
  scope      text NOT NULL CHECK (scope IN ('one', 'all', 'expired')),
  count      int  NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE safety_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id   uuid NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  category   text NOT NULL,
  action     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE usage_records (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id      uuid REFERENCES child_profiles(id) ON DELETE CASCADE,
  provider      text NOT NULL,
  kind          text NOT NULL,
  quantity      double precision NOT NULL,
  unit          text NOT NULL,
  est_cost_usd  double precision NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX usage_records_child_time ON usage_records (child_id, created_at);
