import type {
  Availability,
  AvailabilityStatus,
  Club,
  Fixture,
  Formation,
  FormationLayout,
  FormationSlot,
  Id,
  Lineup,
  Member,
  MembershipPlan,
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
  listAvailability(fixtureId: Id): Promise<Availability[]>;
  setAvailability(fixtureId: Id, memberId: Id, status: AvailabilityStatus, note?: string): Promise<Availability>;

  // Lineups
  getLineup(fixtureId: Id): Promise<Lineup | null>;
  saveLineup(lineup: Omit<Lineup, 'id' | 'updatedAt' | 'sharedAt'>): Promise<Lineup>;
  recordShare(fixtureId: Id, memberIds: Id[]): Promise<Lineup | null>;

  // Memberships & payments
  listMembershipPlans(clubId: Id): Promise<MembershipPlan[]>;
  listMemberMemberships(memberId: Id): Promise<MembershipRecord[]>;

  // Auth
  createMagicLink(tokenHash: string, memberId: Id, expiresAt: Date): Promise<void>;
  /** Marks the link used and returns its member, or null if unknown, used or expired. */
  consumeMagicLink(tokenHash: string): Promise<Id | null>;
  createSession(tokenHash: string, memberId: Id, expiresAt: Date): Promise<void>;
  getSessionMember(tokenHash: string): Promise<Id | null>;
  deleteSession(tokenHash: string): Promise<void>;
}

type Row = Record<string, any>;

const toClub = (r: Row): Club => ({ id: r.id, name: r.name });

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
    return this.many('SELECT * FROM membership_plans WHERE club_id = $1 ORDER BY name', [clubId], (r) => ({
      id: r.id,
      clubId: r.club_id,
      name: r.name,
      amountPence: r.amount_pence,
      interval: r.interval,
    }));
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
