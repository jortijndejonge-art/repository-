-- Phase 1 schema. Mirrors shared/contracts/types.ts.
-- Ids are text (uuid by default) so imported/demo data can keep readable ids.

-- A1. Clubs, teams, members, roles --------------------------------------------

CREATE TABLE clubs (
  id         text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE teams (
  id             text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  club_id        text NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  name           text NOT NULL,
  age_group      text NOT NULL CHECK (age_group IN ('U8','U10','U12','U14','U16','U18','Adult')),
  default_format smallint NOT NULL CHECK (default_format IN (5, 7, 11)),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX teams_club_idx ON teams (club_id);

CREATE TABLE members (
  id         text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  club_id    text NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  first_name text NOT NULL,
  last_name  text NOT NULL,
  email      text,
  phone      text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX members_club_idx ON members (club_id);
CREATE UNIQUE INDEX members_club_email_idx ON members (club_id, lower(email)) WHERE email IS NOT NULL;

CREATE TABLE team_memberships (
  team_id   text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  roles     text[] NOT NULL CHECK (roles <@ ARRAY['admin','manager','player','guardian']::text[]),
  PRIMARY KEY (team_id, member_id)
);
CREATE INDEX team_memberships_member_idx ON team_memberships (member_id);

-- A2. Players: positions and ratings -------------------------------------------

CREATE TABLE player_profiles (
  member_id      text PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  display_name   text NOT NULL,
  shirt_number   smallint,
  positions      text[] NOT NULL CHECK (positions <@ ARRAY['GK','DEF','MID','FWD']::text[] AND cardinality(positions) > 0),
  skill          smallint NOT NULL CHECK (skill BETWEEN 1 AND 10),
  stamina        smallint NOT NULL CHECK (stamina BETWEEN 1 AND 10),
  season_minutes integer NOT NULL DEFAULT 0 CHECK (season_minutes >= 0)
);

-- A3. Fixtures and availability (player × fixture) -------------------------------

CREATE TABLE fixtures (
  id               text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  team_id          text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  opponent         text NOT NULL,
  starts_at        timestamptz NOT NULL,
  venue            text NOT NULL,
  home_away        text NOT NULL CHECK (home_away IN ('home','away')),
  format           smallint NOT NULL CHECK (format IN (5, 7, 11)),
  duration_minutes smallint NOT NULL CHECK (duration_minutes > 0),
  periods          smallint NOT NULL CHECK (periods > 0)
);
CREATE INDEX fixtures_team_start_idx ON fixtures (team_id, starts_at);

CREATE TABLE availability (
  fixture_id text NOT NULL REFERENCES fixtures(id) ON DELETE CASCADE,
  member_id  text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  status     text NOT NULL CHECK (status IN ('available','unavailable','maybe','no_response')),
  note       text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fixture_id, member_id)
);

-- A4. Lineups, lineup slots, substitutions ---------------------------------------

CREATE TABLE lineups (
  id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  fixture_id   text NOT NULL UNIQUE REFERENCES fixtures(id) ON DELETE CASCADE,
  formation_id text NOT NULL,
  strategy     text NOT NULL CHECK (strategy IN ('fair','strongest','stamina','manual')),
  bench        text[] NOT NULL DEFAULT '{}',
  shared_at    timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE lineup_slots (
  lineup_id text NOT NULL REFERENCES lineups(id) ON DELETE CASCADE,
  slot_id   text NOT NULL,
  member_id text REFERENCES members(id) ON DELETE SET NULL,
  PRIMARY KEY (lineup_id, slot_id)
);

CREATE TABLE lineup_substitutions (
  lineup_id     text NOT NULL REFERENCES lineups(id) ON DELETE CASCADE,
  seq           smallint NOT NULL,
  minute        smallint NOT NULL,
  slot_id       text NOT NULL,
  off_member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  on_member_id  text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  PRIMARY KEY (lineup_id, seq)
);

CREATE TABLE lineup_shares (
  lineup_id text NOT NULL REFERENCES lineups(id) ON DELETE CASCADE,
  member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  shared_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lineup_id, member_id)
);

-- A5. Membership plans, memberships, payments --------------------------------------

CREATE TABLE membership_plans (
  id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  club_id      text NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  name         text NOT NULL,
  amount_pence integer NOT NULL CHECK (amount_pence >= 0),
  interval     text NOT NULL CHECK (interval IN ('month','quarter','year'))
);

CREATE TABLE memberships (
  member_id        text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  plan_id          text NOT NULL REFERENCES membership_plans(id),
  status           text NOT NULL CHECK (status IN ('active','overdue','cancelled')),
  next_payment_due timestamptz,
  PRIMARY KEY (member_id, plan_id)
);

CREATE TABLE payments (
  id                text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  member_id         text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  plan_id           text REFERENCES membership_plans(id),
  amount_pence      integer NOT NULL CHECK (amount_pence >= 0),
  status            text NOT NULL CHECK (status IN ('pending','succeeded','failed','refunded')),
  stripe_payment_id text UNIQUE,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_member_idx ON payments (member_id);

-- Auth: magic links and sessions (only hashes are stored) ------------------------------

CREATE TABLE magic_links (
  token_hash text PRIMARY KEY,
  member_id  text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  member_id  text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_member_idx ON sessions (member_id);
