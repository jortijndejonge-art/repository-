-- Group chat on each match and training session, for the team's players,
-- their parents and the managers. No private messages: everyone in the event's
-- team sees everything, which is the safeguarding norm where children are involved.
CREATE TABLE event_messages (
  id         text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  team_id    text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  fixture_id text REFERENCES fixtures(id) ON DELETE CASCADE,
  session_id text REFERENCES training_sessions(id) ON DELETE CASCADE,
  author_id  text REFERENCES members(id) ON DELETE SET NULL,
  body       text NOT NULL DEFAULT '',
  -- A lineup posted into a match chat: a snapshot, so later edits post a new card.
  lineup     jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((fixture_id IS NULL) <> (session_id IS NULL)),
  CHECK (body <> '' OR lineup IS NOT NULL)
);
CREATE INDEX event_messages_fixture_idx ON event_messages (fixture_id, created_at) WHERE fixture_id IS NOT NULL;
CREATE INDEX event_messages_session_idx ON event_messages (session_id, created_at) WHERE session_id IS NOT NULL;
CREATE INDEX event_messages_team_idx ON event_messages (team_id);

-- When each member last opened each event's chat, for unread counts.
-- event_key is 'match:<fixture id>' or 'training:<session id>'.
CREATE TABLE event_chat_reads (
  event_key    text NOT NULL,
  member_id    text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL,
  PRIMARY KEY (event_key, member_id)
);
