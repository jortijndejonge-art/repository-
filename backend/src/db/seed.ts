import { fileURLToPath } from 'node:url';
import * as demo from '@hockey/demo';
import { migrate } from './migrate';
import { createPool, type Pool } from './pool';

/**
 * Reset the database to the demo club (A6): U8, U12, U16 and Men's 2s teams,
 * each with a squad, an upcoming fixture and availability. Sign in as
 * coach@example.com (admin + manager of every team).
 */
export async function seed(pool: Pool) {
  await migrate(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE clubs, sessions, magic_links CASCADE');

    await client.query('INSERT INTO clubs (id, name) VALUES ($1, $2)', [demo.club.id, demo.club.name]);
    for (const t of demo.teams) {
      await client.query('INSERT INTO teams (id, club_id, name, age_group, default_format) VALUES ($1, $2, $3, $4, $5)', [
        t.id,
        t.clubId,
        t.name,
        t.ageGroup,
        t.defaultFormat,
      ]);
    }
    for (const m of demo.members) {
      await client.query(
        'INSERT INTO members (id, club_id, first_name, last_name, email, phone) VALUES ($1, $2, $3, $4, $5, $6)',
        [m.id, m.clubId, m.firstName, m.lastName, m.email ?? null, m.phone ?? null],
      );
    }
    for (const tm of demo.memberships) {
      await client.query('INSERT INTO team_memberships (team_id, member_id, roles) VALUES ($1, $2, $3)', [
        tm.teamId,
        tm.memberId,
        tm.roles,
      ]);
    }
    for (const p of Object.values(demo.squads).flat()) {
      await client.query(
        `INSERT INTO player_profiles (member_id, display_name, shirt_number, positions, skill, stamina, season_minutes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [p.memberId, p.displayName, p.shirtNumber ?? null, p.positions, p.skill, p.stamina, p.seasonMinutes],
      );
    }
    for (const f of demo.fixtures) {
      await client.query(
        `INSERT INTO fixtures (id, team_id, opponent, starts_at, venue, home_away, format, duration_minutes, periods)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [f.id, f.teamId, f.opponent, f.startsAt, f.venue, f.homeAway, f.format, f.durationMinutes, f.periods],
      );
    }
    for (const a of demo.seedAvailability()) {
      await client.query('INSERT INTO availability (fixture_id, member_id, status) VALUES ($1, $2, $3)', [
        a.fixtureId,
        a.memberId,
        a.status,
      ]);
    }
    for (const plan of demo.membershipPlans) {
      await client.query(
        'INSERT INTO membership_plans (id, club_id, name, amount_pence, interval) VALUES ($1, $2, $3, $4, $5)',
        [plan.id, plan.clubId, plan.name, plan.amountPence, plan.interval],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pool = createPool();
  seed(pool)
    .then(() => console.log(`Seeded demo club. Sign in as ${demo.coach.email}`))
    .finally(() => pool.end());
}
