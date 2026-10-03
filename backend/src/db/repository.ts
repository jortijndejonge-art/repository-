import type {
  Availability,
  AvailabilityStatus,
  Club,
  Announcement,
  PlayerStats,
  Briefing,
  NewBriefing,
  LiveStatus,
  LiveSubstitution,
  GuardianSummary,
  NewAnnouncement,
  Fixture,
  TrainingResponse,
  TrainingSession,
  TrainingSessionUpdate,
  NewTrainingSession,
  FixtureUpdate,
  NewFixture,
  Formation,
  FormationLayout,
  FormationSlot,
  Id,
  Lineup,
  LineupCard,
  EventKind,
  ChatUnread,
  Member,
  Role,
  MembershipPlan,
  NewMembershipPlan,
  MembershipRecord,
  NewPlayer,
  PlayerProfile,
  PlayerProfileUpdate,
  SquadFormat,
  Team,
  TeamMembership,
} from '@hockey/contracts';
import type { Pool } from './pool';
import type pg from 'pg';

export interface PaymentInput {
  memberId: Id;
  planId: Id;
  amountPence: number;
  status: 'succeeded' | 'failed';
  stripePaymentId: string;
}

export interface DueMembership {
  memberId: Id;
  planId: Id;
  planName: string;
  amountPence: number;
  nextPaymentDue: string;
  firstName: string;
  email?: string;
}

/**
 * Typed data access (A7). The API layer depends only on this interface and
 * receives an implementation by dependency injection.
 */
export interface Repository {
  // Clubs, teams, members
  getClub(id: Id): Promise<Club | null>;
  listClubTeams(clubId: Id): Promise<Team[]>;
  getTeam(id: Id): Promise<Team | null>;
  getMember(id: Id): Promise<Member | null>;
  findMembersByEmail(email: string): Promise<Member[]>;
  listMemberships(memberId: Id): Promise<TeamMembership[]>;
  listTeamMemberships(teamId: Id): Promise<TeamMembership[]>;

  // Players
  listTeamPlayers(teamId: Id): Promise<PlayerProfile[]>;
  addPlayer(teamId: Id, player: NewPlayer): Promise<PlayerProfile>;
  updatePlayer(memberId: Id, update: PlayerProfileUpdate): Promise<PlayerProfile | null>;

  // Custom formations
  listCustomFormations(teamId: Id, format?: SquadFormat): Promise<Formation[]>;
  addCustomFormation(teamId: Id, formation: { name: string; format: SquadFormat; slots: FormationSlot[] }): Promise<Formation>;
  listFormationLayouts(teamId: Id): Promise<FormationLayout[]>;
  saveFormationLayout(teamId: Id, layout: FormationLayout): Promise<FormationLayout>;
  deleteFormationLayout(teamId: Id, formationId: string): Promise<void>;

  // Fixtures & availability
  listTeamFixtures(teamId: Id, from?: string): Promise<Fixture[]>;
  getFixture(id: Id): Promise<Fixture | null>;
  addFixture(teamId: Id, fixture: NewFixture): Promise<Fixture>;
  updateFixture(id: Id, update: FixtureUpdate): Promise<Fixture | null>;
  deleteFixture(id: Id): Promise<boolean>;
  listAvailability(fixtureId: Id): Promise<Availability[]>;
  setAvailability(fixtureId: Id, memberId: Id, status: AvailabilityStatus, note?: string): Promise<Availability>;

  // Season stats
  /** Attendance, availability and minutes for every player in a team, counting only things before `now`. */
  getTeamStats(teamId: Id, now: Date): Promise<PlayerStats[]>;

  // Briefings
  getBriefing(fixtureId: Id): Promise<Briefing | null>;
  saveBriefing(fixtureId: Id, briefing: NewBriefing): Promise<Briefing>;
  deleteBriefing(fixtureId: Id): Promise<boolean>;
  markBriefingSeen(fixtureId: Id, memberId: Id): Promise<void>;
  listBriefingReads(fixtureId: Id): Promise<{ memberId: Id; seenAt: string }[]>;

  // Live matchday
  getLiveMatch(fixtureId: Id): Promise<{ status: LiveStatus; elapsedSeconds: number; resumedAt?: string } | null>;
  createLiveMatch(fixtureId: Id, startedAt: Date): Promise<void>;
  /** Changes a match that is not finished; returns false if it was already finished (or doesn't exist). */
  updateLiveMatch(fixtureId: Id, update: { status: LiveStatus; elapsedSeconds: number; resumedAt: Date | null }): Promise<boolean>;
  listLiveSubstitutions(fixtureId: Id): Promise<LiveSubstitution[]>;
  addLiveSubstitution(fixtureId: Id, substitution: LiveSubstitution): Promise<void>;
  addSeasonMinutes(memberId: Id, minutes: number): Promise<void>;

  // Guardians
  /** The children (members with a player profile) this guardian looks after, with the teams they play for. */
  listChildren(guardianId: Id): Promise<{ memberId: Id; displayName: string; teamIds: Id[] }[]>;
  listGuardians(childId: Id): Promise<GuardianSummary[]>;
  isGuardianOf(guardianId: Id, childId: Id): Promise<boolean>;
  addGuardian(childId: Id, guardianId: Id): Promise<void>;
  createMember(clubId: Id, member: { firstName: string; lastName: string; email: string }): Promise<Member>;
  /** Gives a member a role on a team, keeping any roles they already have there. */
  addTeamRole(teamId: Id, memberId: Id, role: Role): Promise<void>;

  // Announcements
  listAnnouncements(teamId: Id): Promise<Announcement[]>;
  getAnnouncement(id: Id): Promise<Announcement | null>;
  addAnnouncement(teamId: Id, authorId: Id, announcement: NewAnnouncement): Promise<Announcement>;
  deleteAnnouncement(id: Id): Promise<boolean>;

  // Availability chasing
  /** Matches starting in [from, to). */
  listFixturesBetween(from: Date, to: Date): Promise<Fixture[]>;
  /** Record a reminder for a match, only if it was not reminded since `notSince`; false if it was. */
  claimChase(fixtureId: Id, at: Date, notSince: Date): Promise<boolean>;

  // Event chat
  listEventMessages(kind: EventKind, eventId: Id): Promise<StoredMessage[]>;
  addEventMessage(msg: { kind: EventKind; eventId: Id; teamId: Id; authorId: Id | null; body: string; lineup?: LineupCard; system?: boolean }): Promise<StoredMessage>;
  getEventMessage(id: Id): Promise<StoredMessage | null>;
  deleteEventMessage(id: Id): Promise<void>;
  markEventChatRead(kind: EventKind, eventId: Id, memberId: Id): Promise<void>;
  /** Per event of this team: messages since the member last opened it (not counting their own), and the total. */
  chatUnread(teamId: Id, memberId: Id): Promise<ChatUnread[]>;

  // Training
  listTrainingSessions(teamId: Id, from?: string): Promise<TrainingSession[]>;
  getTrainingSession(id: Id): Promise<TrainingSession | null>;
  addTrainingSession(teamId: Id, session: NewTrainingSession): Promise<TrainingSession>;
  updateTrainingSession(id: Id, update: TrainingSessionUpdate): Promise<TrainingSession | null>;
  deleteTrainingSession(id: Id): Promise<boolean>;
  listTrainingResponses(sessionId: Id): Promise<TrainingResponse[]>;
  setTrainingRsvp(sessionId: Id, memberId: Id, status: 'available' | 'unavailable' | 'maybe' | 'no_response'): Promise<void>;
  setTrainingAttendance(sessionId: Id, memberId: Id, attended: boolean): Promise<void>;

  // Lineups
  getLineup(fixtureId: Id): Promise<Lineup | null>;
  saveLineup(lineup: Omit<Lineup, 'id' | 'updatedAt' | 'sharedAt'>): Promise<Lineup>;
  recordShare(fixtureId: Id, memberIds: Id[]): Promise<Lineup | null>;

  // Memberships & payments
  listMembershipPlans(clubId: Id): Promise<MembershipPlan[]>;
  listMemberMemberships(memberId: Id): Promise<MembershipRecord[]>;
  getMembershipPlan(planId: Id): Promise<MembershipPlan | null>;
  addMembershipPlan(clubId: Id, plan: NewMembershipPlan): Promise<MembershipPlan>;
  /** Creates or renews a membership: active, with the next payment due date. */
  activateMembership(memberId: Id, planId: Id, nextPaymentDue: Date): Promise<void>;
  /** Changes the status of an existing membership; does nothing if there isn't one. */
  setMembershipStatus(memberId: Id, planId: Id, status: MembershipRecord['status']): Promise<void>;
  /** Records a payment once per Stripe id; returns false if it was already recorded. */
  recordPayment(payment: PaymentInput): Promise<boolean>;
  /** Active or overdue memberships due before `dueBefore` and not reminded since `remindedBefore`. */
  listDueMemberships(dueBefore: Date, remindedBefore: Date): Promise<DueMembership[]>;
  markReminded(memberId: Id, planId: Id, at: Date): Promise<void>;

  // Auth
  /** Throws a Postgres unique-violation (23505) if another member in the club already has this email. */
  setMemberEmail(memberId: Id, email: string): Promise<void>;
  getPasswordHash(memberId: Id): Promise<string | null>;
  setPasswordHash(memberId: Id, hash: string): Promise<void>;
  createMagicLink(tokenHash: string, memberId: Id, expiresAt: Date): Promise<void>;
  /** Marks the link used and returns its member, or null if unknown, used or expired. */
  consumeMagicLink(tokenHash: string): Promise<Id | null>;
  createSession(tokenHash: string, memberId: Id, expiresAt: Date): Promise<void>;
  getSessionMember(tokenHash: string): Promise<Id | null>;
  deleteSession(tokenHash: string): Promise<void>;
}

type Row = Record<string, any>;

const toClub = (r: Row): Club => ({ id: r.id, name: r.name });

const toPlan = (r: Row): MembershipPlan => ({
  id: r.id,
  clubId: r.club_id,
  name: r.name,
  amountPence: r.amount_pence,
  interval: r.interval,
});

const toTeam = (r: Row): Team => ({
  id: r.id,
  clubId: r.club_id,
  name: r.name,
  ageGroup: r.age_group,
  defaultFormat: r.default_format as SquadFormat,
});

const toMember = (r: Row): Member => ({
  id: r.id,
  clubId: r.club_id,
  firstName: r.first_name,
  lastName: r.last_name,
  ...(r.email ? { email: r.email } : {}),
  ...(r.phone ? { phone: r.phone } : {}),
});

const toMembership = (r: Row): TeamMembership => ({ teamId: r.team_id, memberId: r.member_id, roles: r.roles });

const toPlayer = (r: Row): PlayerProfile => ({
  memberId: r.member_id,
  displayName: r.display_name,
  ...(r.shirt_number != null ? { shirtNumber: r.shirt_number } : {}),
  positions: r.positions,
  skill: r.skill,
  stamina: r.stamina,
  seasonMinutes: r.season_minutes,
});

const toFixture = (r: Row): Fixture => ({
  id: r.id,
  teamId: r.team_id,
  opponent: r.opponent,
  startsAt: r.starts_at,
  venue: r.venue,
  homeAway: r.home_away,
  format: r.format as SquadFormat,
  durationMinutes: r.duration_minutes,
  periods: r.periods,
});

const ANNOUNCEMENT_SELECT = `SELECT a.*, COALESCE(m.first_name || ' ' || m.last_name, 'The club') AS author_name
  FROM announcements a LEFT JOIN members m ON m.id = a.author_id`;

const toAnnouncement = (r: Row): Announcement => ({
  id: r.id,
  teamId: r.team_id,
  authorName: r.author_name,
  title: r.title,
  body: r.body,
  createdAt: r.created_at,
});

const toBriefing = (r: Row): Briefing => ({
  fixtureId: r.fixture_id,
  body: r.body,
  links: r.links,
  updatedAt: r.updated_at,
});

const toTraining = (r: Row): TrainingSession => ({
  id: r.id,
  teamId: r.team_id,
  startsAt: r.starts_at,
  durationMinutes: r.duration_minutes,
  venue: r.venue,
  ...(r.notes ? { notes: r.notes } : {}),
});

const toAvailability = (r: Row): Availability => ({
  fixtureId: r.fixture_id,
  memberId: r.member_id,
  status: r.status,
  ...(r.note ? { note: r.note } : {}),
  updatedAt: r.updated_at,
});

const toCustomFormation = (r: Row): Formation => ({
  id: r.id,
  name: r.name,
  format: r.format as SquadFormat,
  slots: r.slots,
  teamId: r.team_id,
});

/** A chat message as stored; the service adds who the author is to the team (manager, player, parent of…). */
export interface StoredMessage {
  id: Id;
  teamId: Id;
  kind: EventKind;
  eventId: Id;
  authorId: Id | null;
  authorName: string;
  /** An automatic message (a reminder), not written by a person. */
  system?: boolean;
  body: string;
  lineup?: LineupCard;
  createdAt: string;
}

const toStoredMessage = (r: Row): StoredMessage => ({
  id: r.id,
  teamId: r.team_id,
  kind: r.fixture_id ? 'match' : 'training',
  eventId: r.fixture_id ?? r.session_id,
  authorId: r.author_id,
  authorName: r.system ? 'Reminder' : r.author_first ? `${r.author_first} ${r.author_last}` : 'Former member',
  ...(r.system ? { system: true } : {}),
  body: r.body,
  ...(r.lineup ? { lineup: r.lineup } : {}),
  createdAt: r.created_at,
});

const toFormationLayout = (r: Row): FormationLayout => ({ formationId: r.formation_id, positions: r.positions });

const PLAYER_COLUMNS = 'member_id, display_name, shirt_number, positions, skill, stamina, season_minutes';

export class PgRepository implements Repository {
  constructor(private readonly pool: Pool) {}

  private async one<T>(sql: string, params: unknown[], map: (r: Row) => T): Promise<T | null> {
    const { rows } = await this.pool.query(sql, params);
    return rows[0] ? map(rows[0]) : null;
  }

  private async many<T>(sql: string, params: unknown[], map: (r: Row) => T): Promise<T[]> {
    const { rows } = await this.pool.query(sql, params);
    return rows.map(map);
  }

  private async tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  getClub(id: Id) {
    return this.one('SELECT * FROM clubs WHERE id = $1', [id], toClub);
  }

  listClubTeams(clubId: Id) {
    return this.many('SELECT * FROM teams WHERE club_id = $1 ORDER BY name', [clubId], toTeam);
  }

  getTeam(id: Id) {
    return this.one('SELECT * FROM teams WHERE id = $1', [id], toTeam);
  }

  getMember(id: Id) {
    return this.one('SELECT * FROM members WHERE id = $1', [id], toMember);
  }

  findMembersByEmail(email: string) {
    return this.many('SELECT * FROM members WHERE lower(email) = lower($1)', [email.trim()], toMember);
  }

  listMemberships(memberId: Id) {
    return this.many('SELECT * FROM team_memberships WHERE member_id = $1', [memberId], toMembership);
  }

  listTeamMemberships(teamId: Id) {
    return this.many('SELECT * FROM team_memberships WHERE team_id = $1', [teamId], toMembership);
  }

  listTeamPlayers(teamId: Id) {
    return this.many(
      `SELECT ${PLAYER_COLUMNS.split(', ').map((c) => `p.${c}`).join(', ')}
         FROM player_profiles p
         JOIN team_memberships tm ON tm.member_id = p.member_id
        WHERE tm.team_id = $1 AND 'player' = ANY(tm.roles)
        ORDER BY p.shirt_number NULLS LAST, p.display_name`,
      [teamId],
      toPlayer,
    );
  }

  async addPlayer(teamId: Id, player: NewPlayer): Promise<PlayerProfile> {
    return this.tx(async (c) => {
      const team = (await c.query('SELECT club_id FROM teams WHERE id = $1', [teamId])).rows[0];
      if (!team) throw new Error(`Unknown team ${teamId}`);
      const member = (
        await c.query(
          `INSERT INTO members (club_id, first_name, last_name, email, phone) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [team.club_id, player.firstName, player.lastName, player.email ?? null, player.phone ?? null],
        )
      ).rows[0];
      await c.query(`INSERT INTO team_memberships (team_id, member_id, roles) VALUES ($1, $2, '{player}')`, [
        teamId,
        member.id,
      ]);
      const displayName = player.displayName ?? `${player.firstName} ${player.lastName.charAt(0)}.`;
      const row = (
        await c.query(
          `INSERT INTO player_profiles (member_id, display_name, shirt_number, positions, skill, stamina, season_minutes)
           VALUES ($1, $2, $3, $4, $5, $6, 0) RETURNING ${PLAYER_COLUMNS}`,
          [member.id, displayName, player.shirtNumber ?? null, player.positions, player.skill, player.stamina],
        )
      ).rows[0];
      return toPlayer(row);
    });
  }

  updatePlayer(memberId: Id, update: PlayerProfileUpdate) {
    const columns: Record<keyof PlayerProfileUpdate, string> = {
      displayName: 'display_name',
      shirtNumber: 'shirt_number',
      positions: 'positions',
      skill: 'skill',
      stamina: 'stamina',
      seasonMinutes: 'season_minutes',
    };
    const sets: string[] = [];
    const params: unknown[] = [memberId];
    for (const [key, column] of Object.entries(columns) as [keyof PlayerProfileUpdate, string][]) {
      if (update[key] !== undefined) {
        params.push(update[key]);
        sets.push(`${column} = $${params.length}`);
      }
    }
    if (sets.length === 0) {
      return this.one(`SELECT ${PLAYER_COLUMNS} FROM player_profiles WHERE member_id = $1`, [memberId], toPlayer);
    }
    return this.one(
      `UPDATE player_profiles SET ${sets.join(', ')} WHERE member_id = $1 RETURNING ${PLAYER_COLUMNS}`,
      params,
      toPlayer,
    );
  }

  listCustomFormations(teamId: Id, format?: SquadFormat) {
    return this.many(
      'SELECT * FROM custom_formations WHERE team_id = $1 AND format = COALESCE($2, format) ORDER BY created_at',
      [teamId, format ?? null],
      toCustomFormation,
    );
  }

  async addCustomFormation(teamId: Id, formation: { name: string; format: SquadFormat; slots: FormationSlot[] }) {
    const row = (
      await this.pool.query(
        `INSERT INTO custom_formations (team_id, name, format, slots)
         VALUES ($1, $2, $3, $4::jsonb) RETURNING *`,
        [teamId, formation.name, formation.format, JSON.stringify(formation.slots)],
      )
    ).rows[0];
    return toCustomFormation(row);
  }

  listFormationLayouts(teamId: Id) {
    return this.many('SELECT * FROM formation_layouts WHERE team_id = $1', [teamId], toFormationLayout);
  }

  async saveFormationLayout(teamId: Id, layout: FormationLayout) {
    const row = (
      await this.pool.query(
        `INSERT INTO formation_layouts (team_id, formation_id, positions, updated_at)
         VALUES ($1, $2, $3::jsonb, now())
         ON CONFLICT (team_id, formation_id)
         DO UPDATE SET positions = EXCLUDED.positions, updated_at = now()
         RETURNING *`,
        [teamId, layout.formationId, JSON.stringify(layout.positions)],
      )
    ).rows[0];
    return toFormationLayout(row);
  }

  async deleteFormationLayout(teamId: Id, formationId: string) {
    await this.pool.query('DELETE FROM formation_layouts WHERE team_id = $1 AND formation_id = $2', [teamId, formationId]);
  }

  listTeamFixtures(teamId: Id, from?: string) {
    return this.many(
      'SELECT * FROM fixtures WHERE team_id = $1 AND starts_at >= COALESCE($2::timestamptz, \'-infinity\') ORDER BY starts_at',
      [teamId, from ?? null],
      toFixture,
    );
  }

  getFixture(id: Id) {
    return this.one('SELECT * FROM fixtures WHERE id = $1', [id], toFixture);
  }

  async addFixture(teamId: Id, f: NewFixture) {
    const { rows } = await this.pool.query(
      `INSERT INTO fixtures (team_id, opponent, starts_at, venue, home_away, format, duration_minutes, periods)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [teamId, f.opponent, f.startsAt, f.venue, f.homeAway, f.format, f.durationMinutes, f.periods],
    );
    return toFixture(rows[0]);
  }

  async updateFixture(id: Id, u: FixtureUpdate) {
    const columns: Record<string, unknown> = {
      opponent: u.opponent,
      starts_at: u.startsAt,
      venue: u.venue,
      home_away: u.homeAway,
      format: u.format,
      duration_minutes: u.durationMinutes,
      periods: u.periods,
    };
    const set = Object.entries(columns).filter(([, v]) => v !== undefined);
    if (set.length === 0) return this.getFixture(id);
    return this.one(
      `UPDATE fixtures SET ${set.map(([k], i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`,
      [id, ...set.map(([, v]) => v)],
      toFixture,
    );
  }

  async deleteFixture(id: Id) {
    const res = await this.pool.query('DELETE FROM fixtures WHERE id = $1', [id]);
    return (res.rowCount ?? 0) > 0;
  }

  listAvailability(fixtureId: Id) {
    return this.many('SELECT * FROM availability WHERE fixture_id = $1', [fixtureId], toAvailability);
  }

  async setAvailability(fixtureId: Id, memberId: Id, status: AvailabilityStatus, note?: string) {
    const row = await this.one(
      `INSERT INTO availability (fixture_id, member_id, status, note, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (fixture_id, member_id)
       DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, updated_at = now()
       RETURNING *`,
      [fixtureId, memberId, status, note ?? null],
      toAvailability,
    );
    return row!;
  }

  getTeamStats(teamId: Id, now: Date) {
    // Training counts only sessions where attendance was recorded, so a session nobody ticked doesn't count against anyone.
    return this.many(
      `WITH past_sessions AS (
         SELECT s.id FROM training_sessions s
          WHERE s.team_id = $1 AND s.starts_at < $2
            AND EXISTS (SELECT 1 FROM training_responses r WHERE r.session_id = s.id AND r.attended IS NOT NULL)
       ), past_fixtures AS (
         SELECT id FROM fixtures WHERE team_id = $1 AND starts_at < $2
       )
       SELECT p.member_id, p.display_name, p.season_minutes,
              (SELECT count(*) FROM past_sessions) AS training_total,
              (SELECT count(*) FROM training_responses r JOIN past_sessions ps ON ps.id = r.session_id
                WHERE r.member_id = p.member_id AND r.attended) AS training_attended,
              (SELECT count(*) FROM past_fixtures) AS matches_total,
              (SELECT count(*) FROM availability a JOIN past_fixtures pf ON pf.id = a.fixture_id
                WHERE a.member_id = p.member_id AND a.status = 'available') AS matches_available
         FROM player_profiles p
         JOIN team_memberships tm ON tm.member_id = p.member_id AND tm.team_id = $1 AND 'player' = ANY (tm.roles)
        ORDER BY p.display_name`,
      [teamId, now],
      (r) => ({
        memberId: r.member_id as Id,
        displayName: r.display_name as string,
        trainingAttended: Number(r.training_attended),
        trainingTotal: Number(r.training_total),
        matchesAvailable: Number(r.matches_available),
        matchesTotal: Number(r.matches_total),
        seasonMinutes: r.season_minutes as number,
      }),
    );
  }

  getBriefing(fixtureId: Id) {
    return this.one('SELECT * FROM briefings WHERE fixture_id = $1', [fixtureId], toBriefing);
  }

  async saveBriefing(fixtureId: Id, b: NewBriefing) {
    const { rows } = await this.pool.query(
      `INSERT INTO briefings (fixture_id, body, links, updated_at) VALUES ($1, $2, $3::jsonb, now())
       ON CONFLICT (fixture_id) DO UPDATE SET body = EXCLUDED.body, links = EXCLUDED.links, updated_at = now()
       RETURNING *`,
      [fixtureId, b.body, JSON.stringify(b.links)],
    );
    return toBriefing(rows[0]);
  }

  async deleteBriefing(fixtureId: Id) {
    await this.pool.query('DELETE FROM briefing_reads WHERE fixture_id = $1', [fixtureId]);
    const res = await this.pool.query('DELETE FROM briefings WHERE fixture_id = $1', [fixtureId]);
    return (res.rowCount ?? 0) > 0;
  }

  async markBriefingSeen(fixtureId: Id, memberId: Id) {
    await this.pool.query(
      `INSERT INTO briefing_reads (fixture_id, member_id, seen_at) VALUES ($1, $2, now())
       ON CONFLICT (fixture_id, member_id) DO UPDATE SET seen_at = now()`,
      [fixtureId, memberId],
    );
  }

  listBriefingReads(fixtureId: Id) {
    return this.many('SELECT member_id, seen_at FROM briefing_reads WHERE fixture_id = $1', [fixtureId], (r) => ({
      memberId: r.member_id as Id,
      seenAt: r.seen_at as string,
    }));
  }

  getLiveMatch(fixtureId: Id) {
    return this.one('SELECT * FROM live_matches WHERE fixture_id = $1', [fixtureId], (r) => ({
      status: r.status as LiveStatus,
      elapsedSeconds: r.elapsed_seconds as number,
      ...(r.resumed_at ? { resumedAt: r.resumed_at as string } : {}),
    }));
  }

  async createLiveMatch(fixtureId: Id, startedAt: Date) {
    await this.pool.query(
      "INSERT INTO live_matches (fixture_id, status, elapsed_seconds, resumed_at) VALUES ($1, 'running', 0, $2)",
      [fixtureId, startedAt],
    );
  }

  async updateLiveMatch(fixtureId: Id, u: { status: LiveStatus; elapsedSeconds: number; resumedAt: Date | null }) {
    const res = await this.pool.query(
      "UPDATE live_matches SET status = $2, elapsed_seconds = $3, resumed_at = $4 WHERE fixture_id = $1 AND status <> 'finished'",
      [fixtureId, u.status, u.elapsedSeconds, u.resumedAt],
    );
    return (res.rowCount ?? 0) > 0;
  }

  listLiveSubstitutions(fixtureId: Id) {
    return this.many('SELECT * FROM live_substitutions WHERE fixture_id = $1 ORDER BY id', [fixtureId], (r) => ({
      atSecond: r.at_second as number,
      slotId: r.slot_id as string,
      offMemberId: r.off_member_id as Id,
      onMemberId: r.on_member_id as Id,
    }));
  }

  async addLiveSubstitution(fixtureId: Id, s: LiveSubstitution) {
    await this.pool.query(
      'INSERT INTO live_substitutions (fixture_id, at_second, slot_id, off_member_id, on_member_id) VALUES ($1, $2, $3, $4, $5)',
      [fixtureId, s.atSecond, s.slotId, s.offMemberId, s.onMemberId],
    );
  }

  async addSeasonMinutes(memberId: Id, minutes: number) {
    await this.pool.query('UPDATE player_profiles SET season_minutes = season_minutes + $2 WHERE member_id = $1', [memberId, minutes]);
  }

  async listChildren(guardianId: Id) {
    const { rows } = await this.pool.query(
      `SELECT p.member_id, p.display_name,
              COALESCE(array_agg(tm.team_id) FILTER (WHERE tm.team_id IS NOT NULL), '{}') AS team_ids
         FROM guardianships g
         JOIN player_profiles p ON p.member_id = g.child_id
         LEFT JOIN team_memberships tm ON tm.member_id = g.child_id AND 'player' = ANY (tm.roles)
        WHERE g.guardian_id = $1
        GROUP BY p.member_id, p.display_name
        ORDER BY p.display_name`,
      [guardianId],
    );
    return rows.map((r) => ({ memberId: r.member_id as Id, displayName: r.display_name as string, teamIds: r.team_ids as Id[] }));
  }

  listGuardians(childId: Id) {
    return this.many(
      `SELECT m.* FROM guardianships g JOIN members m ON m.id = g.guardian_id WHERE g.child_id = $1 ORDER BY m.first_name`,
      [childId],
      (r) => ({
        memberId: r.id as Id,
        firstName: r.first_name as string,
        lastName: r.last_name as string,
        ...(r.email ? { email: r.email as string } : {}),
      }),
    );
  }

  async isGuardianOf(guardianId: Id, childId: Id) {
    const { rowCount } = await this.pool.query('SELECT 1 FROM guardianships WHERE guardian_id = $1 AND child_id = $2', [
      guardianId,
      childId,
    ]);
    return (rowCount ?? 0) > 0;
  }

  async addGuardian(childId: Id, guardianId: Id) {
    await this.pool.query('INSERT INTO guardianships (guardian_id, child_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
      guardianId,
      childId,
    ]);
  }

  async createMember(clubId: Id, m: { firstName: string; lastName: string; email: string }) {
    const { rows } = await this.pool.query(
      'INSERT INTO members (club_id, first_name, last_name, email) VALUES ($1, $2, $3, lower($4)) RETURNING *',
      [clubId, m.firstName, m.lastName, m.email.trim()],
    );
    return toMember(rows[0]);
  }

  async addTeamRole(teamId: Id, memberId: Id, role: Role) {
    await this.pool.query(
      `INSERT INTO team_memberships (team_id, member_id, roles) VALUES ($1, $2, ARRAY[$3]::text[])
       ON CONFLICT (team_id, member_id) DO UPDATE
         SET roles = ARRAY(SELECT DISTINCT unnest(team_memberships.roles || EXCLUDED.roles))`,
      [teamId, memberId, role],
    );
  }

  listAnnouncements(teamId: Id) {
    return this.many(`${ANNOUNCEMENT_SELECT} WHERE a.team_id = $1 ORDER BY a.created_at DESC`, [teamId], toAnnouncement);
  }

  getAnnouncement(id: Id) {
    return this.one(`${ANNOUNCEMENT_SELECT} WHERE a.id = $1`, [id], toAnnouncement);
  }

  async addAnnouncement(teamId: Id, authorId: Id, a: NewAnnouncement) {
    const { rows } = await this.pool.query(
      'INSERT INTO announcements (team_id, author_id, title, body) VALUES ($1, $2, $3, $4) RETURNING id',
      [teamId, authorId, a.title, a.body],
    );
    return (await this.getAnnouncement(rows[0].id))!;
  }

  listEventMessages(kind: EventKind, eventId: Id) {
    const column = kind === 'match' ? 'fixture_id' : 'session_id';
    return this.many(
      `SELECT m.*, a.first_name AS author_first, a.last_name AS author_last
         FROM event_messages m LEFT JOIN members a ON a.id = m.author_id
        WHERE m.${column} = $1 ORDER BY m.created_at, m.id`,
      [eventId],
      toStoredMessage,
    );
  }

  listFixturesBetween(from: Date, to: Date) {
    return this.many('SELECT * FROM fixtures WHERE starts_at >= $1 AND starts_at < $2 ORDER BY starts_at', [from, to], toFixture);
  }

  async claimChase(fixtureId: Id, at: Date, notSince: Date) {
    const res = await this.pool.query(
      'UPDATE fixtures SET last_chased_at = $2 WHERE id = $1 AND (last_chased_at IS NULL OR last_chased_at < $3)',
      [fixtureId, at, notSince],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async addEventMessage(msg: { kind: EventKind; eventId: Id; teamId: Id; authorId: Id | null; body: string; lineup?: LineupCard; system?: boolean }) {
    const { rows } = await this.pool.query(
      `INSERT INTO event_messages (team_id, fixture_id, session_id, author_id, body, lineup, system)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        msg.teamId,
        msg.kind === 'match' ? msg.eventId : null,
        msg.kind === 'training' ? msg.eventId : null,
        msg.authorId,
        msg.body,
        msg.lineup ? JSON.stringify(msg.lineup) : null,
        msg.system ?? false,
      ],
    );
    return (await this.getEventMessage(rows[0].id))!;
  }

  getEventMessage(id: Id) {
    return this.one(
      `SELECT m.*, a.first_name AS author_first, a.last_name AS author_last
         FROM event_messages m LEFT JOIN members a ON a.id = m.author_id WHERE m.id = $1`,
      [id],
      toStoredMessage,
    );
  }

  async deleteEventMessage(id: Id) {
    await this.pool.query('DELETE FROM event_messages WHERE id = $1', [id]);
  }

  async markEventChatRead(kind: EventKind, eventId: Id, memberId: Id) {
    await this.pool.query(
      `INSERT INTO event_chat_reads (event_key, member_id, last_read_at) VALUES ($1, $2, now())
       ON CONFLICT (event_key, member_id) DO UPDATE SET last_read_at = now()`,
      [`${kind}:${eventId}`, memberId],
    );
  }

  chatUnread(teamId: Id, memberId: Id) {
    return this.many(
      `SELECT e.kind, e.event_id,
              count(*)::int AS total,
              (count(*) FILTER (WHERE m.created_at > COALESCE(r.last_read_at, '-infinity')
                                  AND m.author_id IS DISTINCT FROM $2))::int AS unread
         FROM event_messages m
         CROSS JOIN LATERAL (SELECT CASE WHEN m.fixture_id IS NOT NULL THEN 'match' ELSE 'training' END AS kind,
                                    COALESCE(m.fixture_id, m.session_id) AS event_id) e
         LEFT JOIN event_chat_reads r ON r.event_key = e.kind || ':' || e.event_id AND r.member_id = $2
        WHERE m.team_id = $1
        GROUP BY e.kind, e.event_id`,
      [teamId, memberId],
      (r) => ({ kind: r.kind as EventKind, eventId: r.event_id as Id, unread: r.unread as number, total: r.total as number }),
    );
  }

  async deleteAnnouncement(id: Id) {
    const res = await this.pool.query('DELETE FROM announcements WHERE id = $1', [id]);
    return (res.rowCount ?? 0) > 0;
  }

  listTrainingSessions(teamId: Id, from?: string) {
    return this.many(
      "SELECT * FROM training_sessions WHERE team_id = $1 AND starts_at >= COALESCE($2::timestamptz, '-infinity') ORDER BY starts_at",
      [teamId, from ?? null],
      toTraining,
    );
  }

  getTrainingSession(id: Id) {
    return this.one('SELECT * FROM training_sessions WHERE id = $1', [id], toTraining);
  }

  async addTrainingSession(teamId: Id, s: NewTrainingSession) {
    const { rows } = await this.pool.query(
      `INSERT INTO training_sessions (team_id, starts_at, duration_minutes, venue, notes)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [teamId, s.startsAt, s.durationMinutes, s.venue, s.notes ?? null],
    );
    return toTraining(rows[0]);
  }

  async updateTrainingSession(id: Id, u: TrainingSessionUpdate) {
    const columns: Record<string, unknown> = {
      starts_at: u.startsAt,
      duration_minutes: u.durationMinutes,
      venue: u.venue,
      notes: u.notes,
    };
    const set = Object.entries(columns).filter(([, v]) => v !== undefined);
    if (set.length === 0) return this.getTrainingSession(id);
    return this.one(
      `UPDATE training_sessions SET ${set.map(([k], i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`,
      [id, ...set.map(([, v]) => v)],
      toTraining,
    );
  }

  async deleteTrainingSession(id: Id) {
    const res = await this.pool.query('DELETE FROM training_sessions WHERE id = $1', [id]);
    return (res.rowCount ?? 0) > 0;
  }

  listTrainingResponses(sessionId: Id) {
    return this.many('SELECT * FROM training_responses WHERE session_id = $1', [sessionId], (r) => ({
      sessionId: r.session_id,
      memberId: r.member_id,
      rsvp: (r.rsvp ?? 'no_response') as AvailabilityStatus,
      ...(r.attended != null ? { attended: r.attended as boolean } : {}),
    }));
  }

  async setTrainingRsvp(sessionId: Id, memberId: Id, status: AvailabilityStatus) {
    await this.pool.query(
      `INSERT INTO training_responses (session_id, member_id, rsvp) VALUES ($1, $2, $3)
       ON CONFLICT (session_id, member_id) DO UPDATE SET rsvp = EXCLUDED.rsvp`,
      [sessionId, memberId, status === 'no_response' ? null : status],
    );
  }

  async setTrainingAttendance(sessionId: Id, memberId: Id, attended: boolean) {
    await this.pool.query(
      `INSERT INTO training_responses (session_id, member_id, attended) VALUES ($1, $2, $3)
       ON CONFLICT (session_id, member_id) DO UPDATE SET attended = EXCLUDED.attended`,
      [sessionId, memberId, attended],
    );
  }

  async getLineup(fixtureId: Id): Promise<Lineup | null> {
    const lineup = (await this.pool.query('SELECT * FROM lineups WHERE fixture_id = $1', [fixtureId])).rows[0];
    if (!lineup) return null;
    const [slots, subs] = await Promise.all([
      this.pool.query('SELECT slot_id, member_id FROM lineup_slots WHERE lineup_id = $1 ORDER BY slot_id', [lineup.id]),
      this.pool.query('SELECT * FROM lineup_substitutions WHERE lineup_id = $1 ORDER BY seq', [lineup.id]),
    ]);
    return {
      id: lineup.id,
      fixtureId: lineup.fixture_id,
      formationId: lineup.formation_id,
      strategy: lineup.strategy,
      starting: slots.rows.map((r) => ({ slotId: r.slot_id, memberId: r.member_id })),
      bench: lineup.bench,
      substitutions: subs.rows.map((r) => ({
        minute: r.minute,
        slotId: r.slot_id,
        offMemberId: r.off_member_id,
        onMemberId: r.on_member_id,
      })),
      ...(lineup.shared_at ? { sharedAt: lineup.shared_at } : {}),
      updatedAt: lineup.updated_at,
    };
  }

  async saveLineup(lineup: Omit<Lineup, 'id' | 'updatedAt' | 'sharedAt'>): Promise<Lineup> {
    await this.tx(async (c) => {
      const { id } = (
        await c.query(
          `INSERT INTO lineups (fixture_id, formation_id, strategy, bench, updated_at)
           VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (fixture_id)
           DO UPDATE SET formation_id = EXCLUDED.formation_id, strategy = EXCLUDED.strategy,
                         bench = EXCLUDED.bench, updated_at = now()
           RETURNING id`,
          [lineup.fixtureId, lineup.formationId, lineup.strategy, lineup.bench],
        )
      ).rows[0];
      await c.query('DELETE FROM lineup_slots WHERE lineup_id = $1', [id]);
      await c.query('DELETE FROM lineup_substitutions WHERE lineup_id = $1', [id]);
      for (const slot of lineup.starting) {
        await c.query('INSERT INTO lineup_slots (lineup_id, slot_id, member_id) VALUES ($1, $2, $3)', [
          id,
          slot.slotId,
          slot.memberId,
        ]);
      }
      for (const [seq, sub] of lineup.substitutions.entries()) {
        await c.query(
          `INSERT INTO lineup_substitutions (lineup_id, seq, minute, slot_id, off_member_id, on_member_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, seq, sub.minute, sub.slotId, sub.offMemberId, sub.onMemberId],
        );
      }
    });
    return (await this.getLineup(lineup.fixtureId))!;
  }

  async recordShare(fixtureId: Id, memberIds: Id[]) {
    const updated = await this.tx(async (c) => {
      const lineup = (
        await c.query('UPDATE lineups SET shared_at = now() WHERE fixture_id = $1 RETURNING id', [fixtureId])
      ).rows[0];
      if (!lineup) return false;
      await c.query(
        `INSERT INTO lineup_shares (lineup_id, member_id)
         SELECT $1, unnest($2::text[])
         ON CONFLICT (lineup_id, member_id) DO UPDATE SET shared_at = now()`,
        [lineup.id, memberIds],
      );
      return true;
    });
    return updated ? this.getLineup(fixtureId) : null;
  }

  listMembershipPlans(clubId: Id) {
    return this.many('SELECT * FROM membership_plans WHERE club_id = $1 ORDER BY name', [clubId], toPlan);
  }

  getMembershipPlan(planId: Id) {
    return this.one('SELECT * FROM membership_plans WHERE id = $1', [planId], toPlan);
  }

  async addMembershipPlan(clubId: Id, plan: NewMembershipPlan) {
    const rows = await this.pool.query(
      'INSERT INTO membership_plans (club_id, name, amount_pence, interval) VALUES ($1, $2, $3, $4) RETURNING *',
      [clubId, plan.name, plan.amountPence, plan.interval],
    );
    return toPlan(rows.rows[0]);
  }

  async activateMembership(memberId: Id, planId: Id, nextPaymentDue: Date) {
    await this.pool.query(
      `INSERT INTO memberships (member_id, plan_id, status, next_payment_due) VALUES ($1, $2, 'active', $3)
       ON CONFLICT (member_id, plan_id) DO UPDATE SET status = 'active', next_payment_due = $3, last_reminder_at = NULL`,
      [memberId, planId, nextPaymentDue],
    );
  }

  async setMembershipStatus(memberId: Id, planId: Id, status: MembershipRecord['status']) {
    await this.pool.query('UPDATE memberships SET status = $3 WHERE member_id = $1 AND plan_id = $2', [
      memberId,
      planId,
      status,
    ]);
  }

  async recordPayment(p: PaymentInput) {
    const res = await this.pool.query(
      `INSERT INTO payments (member_id, plan_id, amount_pence, status, stripe_payment_id)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (stripe_payment_id) DO NOTHING`,
      [p.memberId, p.planId, p.amountPence, p.status, p.stripePaymentId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  listDueMemberships(dueBefore: Date, remindedBefore: Date) {
    return this.many(
      `SELECT ms.member_id, ms.plan_id, ms.next_payment_due, p.name AS plan_name, p.amount_pence,
              m.first_name, m.email
         FROM memberships ms
         JOIN membership_plans p ON p.id = ms.plan_id
         JOIN members m ON m.id = ms.member_id
        WHERE ms.status IN ('active', 'overdue')
          AND ms.next_payment_due IS NOT NULL AND ms.next_payment_due < $1
          AND (ms.last_reminder_at IS NULL OR ms.last_reminder_at < $2)`,
      [dueBefore, remindedBefore],
      (r) => ({
        memberId: r.member_id,
        planId: r.plan_id,
        planName: r.plan_name,
        amountPence: r.amount_pence,
        nextPaymentDue: new Date(r.next_payment_due).toISOString(),
        firstName: r.first_name,
        ...(r.email ? { email: r.email } : {}),
      }),
    );
  }

  async markReminded(memberId: Id, planId: Id, at: Date) {
    await this.pool.query('UPDATE memberships SET last_reminder_at = $3 WHERE member_id = $1 AND plan_id = $2', [
      memberId,
      planId,
      at,
    ]);
  }

  listMemberMemberships(memberId: Id) {
    return this.many('SELECT * FROM memberships WHERE member_id = $1', [memberId], (r) => ({
      memberId: r.member_id,
      planId: r.plan_id,
      status: r.status,
      ...(r.next_payment_due ? { nextPaymentDue: r.next_payment_due } : {}),
    }));
  }

  async createMagicLink(tokenHash: string, memberId: Id, expiresAt: Date) {
    await this.pool.query('INSERT INTO magic_links (token_hash, member_id, expires_at) VALUES ($1, $2, $3)', [
      tokenHash,
      memberId,
      expiresAt,
    ]);
  }

  async consumeMagicLink(tokenHash: string) {
    return this.one(
      `UPDATE magic_links SET used_at = now()
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
        RETURNING member_id`,
      [tokenHash],
      (r) => r.member_id as Id,
    );
  }

  async setMemberEmail(memberId: Id, email: string) {
    await this.pool.query('UPDATE members SET email = lower($2) WHERE id = $1', [memberId, email.trim()]);
  }

  async getPasswordHash(memberId: Id) {
    return (await this.one('SELECT password_hash FROM members WHERE id = $1', [memberId], (r) => r.password_hash as string | null)) ?? null;
  }

  async setPasswordHash(memberId: Id, hash: string) {
    await this.pool.query('UPDATE members SET password_hash = $2 WHERE id = $1', [memberId, hash]);
  }

  async createSession(tokenHash: string, memberId: Id, expiresAt: Date) {
    await this.pool.query('INSERT INTO sessions (token_hash, member_id, expires_at) VALUES ($1, $2, $3)', [
      tokenHash,
      memberId,
      expiresAt,
    ]);
  }

  getSessionMember(tokenHash: string) {
    return this.one(
      'SELECT member_id FROM sessions WHERE token_hash = $1 AND expires_at > now()',
      [tokenHash],
      (r) => r.member_id as Id,
    );
  }

  async deleteSession(tokenHash: string) {
    await this.pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
  }
}
