CREATE TABLE custom_formations (
  id         text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  team_id    text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name       text NOT NULL,
  format     smallint NOT NULL CHECK (format IN (5, 7, 11)),
  slots      jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX custom_formations_team_idx ON custom_formations (team_id);
