-- Phase 4a: the club's pitches, when each is open to which age groups, and which match is booked where.
ALTER TABLE clubs ADD COLUMN timezone text NOT NULL DEFAULT 'Europe/London';

CREATE TABLE pitches (
  id         text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  club_id    text NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pitches_club_idx ON pitches (club_id);

-- A weekly opening, in the club's local time: Monday = 0 ... Sunday = 6, minutes after midnight.
CREATE TABLE pitch_slots (
  id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  pitch_id     text NOT NULL REFERENCES pitches(id) ON DELETE CASCADE,
  weekday      smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_minute smallint NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute   smallint NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
  age_groups   text[] NOT NULL CHECK (
    cardinality(age_groups) > 0 AND age_groups <@ ARRAY['U8','U10','U12','U14','U16','U18','Adult']::text[]
  ),
  CHECK (end_minute > start_minute)
);
CREATE INDEX pitch_slots_pitch_idx ON pitch_slots (pitch_id);

ALTER TABLE fixtures ADD COLUMN pitch_id text REFERENCES pitches(id) ON DELETE SET NULL;
