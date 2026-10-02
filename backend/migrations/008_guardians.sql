-- Phase 3: parents and guardians. A guardian can answer availability and training RSVPs for their children.
CREATE TABLE guardianships (
  guardian_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  child_id    text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  PRIMARY KEY (guardian_id, child_id),
  CHECK (guardian_id <> child_id)
);
CREATE INDEX guardianships_child_idx ON guardianships (child_id);
