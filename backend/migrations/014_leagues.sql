-- Phase 4b: season planning. A league is a set-up (divisions, opponent clubs and their pitch times, season dates)
-- that the club plans a season from. The set-up is stored as one JSON document.
CREATE TABLE leagues (
  id         text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  club_id    text NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  name       text NOT NULL,
  config     jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX leagues_club_idx ON leagues (club_id);
