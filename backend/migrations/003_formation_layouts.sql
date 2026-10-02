-- A team's own placement of a formation's positions (built-in or custom), overriding the automatic layout.
CREATE TABLE formation_layouts (
  team_id      text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  formation_id text NOT NULL,
  positions    jsonb NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, formation_id)
);
