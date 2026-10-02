-- Phase 3: pre-match briefings. One per match: coaching notes and links, with "seen it" receipts.
CREATE TABLE briefings (
  fixture_id text PRIMARY KEY REFERENCES fixtures(id) ON DELETE CASCADE,
  body       text NOT NULL,
  links      jsonb NOT NULL DEFAULT '[]',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE briefing_reads (
  fixture_id text NOT NULL REFERENCES fixtures(id) ON DELETE CASCADE,
  member_id  text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  seen_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fixture_id, member_id)
);
