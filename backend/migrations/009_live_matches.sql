-- Phase 3: live matchday. The clock and the substitutions actually made.
CREATE TABLE live_matches (
  fixture_id      text PRIMARY KEY REFERENCES fixtures(id) ON DELETE CASCADE,
  status          text NOT NULL CHECK (status IN ('running','paused','finished')),
  -- Playing time banked before the clock was last started.
  elapsed_seconds integer NOT NULL DEFAULT 0 CHECK (elapsed_seconds >= 0),
  -- When the clock was last started; null while paused or finished.
  resumed_at      timestamptz
);

CREATE TABLE live_substitutions (
  id            bigserial PRIMARY KEY,
  fixture_id    text NOT NULL REFERENCES fixtures(id) ON DELETE CASCADE,
  at_second     integer NOT NULL CHECK (at_second >= 0),
  slot_id       text NOT NULL,
  off_member_id text NOT NULL REFERENCES members(id),
  on_member_id  text NOT NULL REFERENCES members(id)
);
CREATE INDEX live_substitutions_fixture_idx ON live_substitutions (fixture_id, id);
