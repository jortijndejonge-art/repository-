-- Phase 2: training sessions, with each player's RSVP and whether they actually came.
CREATE TABLE training_sessions (
  id               text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  team_id          text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  starts_at        timestamptz NOT NULL,
  duration_minutes smallint NOT NULL CHECK (duration_minutes > 0),
  venue            text NOT NULL,
  notes            text
);
CREATE INDEX training_sessions_team_start_idx ON training_sessions (team_id, starts_at);

CREATE TABLE training_responses (
  session_id text NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
  member_id  text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  rsvp       text CHECK (rsvp IN ('available','unavailable','maybe')),
  attended   boolean,
  PRIMARY KEY (session_id, member_id)
);
