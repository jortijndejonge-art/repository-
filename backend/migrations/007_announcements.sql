-- Phase 2: announcements from a manager to a team's squad.
CREATE TABLE announcements (
  id         text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  team_id    text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  author_id  text REFERENCES members(id) ON DELETE SET NULL,
  title      text NOT NULL,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX announcements_team_idx ON announcements (team_id, created_at DESC);
