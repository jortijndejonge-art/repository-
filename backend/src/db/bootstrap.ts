import { fileURLToPath } from 'node:url';
import { migrate } from './migrate';
import { createPool, type Pool } from './pool';

const AGE_GROUPS = ['U8', 'U10', 'U12', 'U14', 'U16', 'U18', 'Adult'];

export interface BootstrapInput {
  clubName: string;
  firstName: string;
  lastName: string;
  email: string;
  /** Each team as "Name:AgeGroup:format", e.g. "U12 Girls:U12:7". */
  teams: string[];
}

/**
 * Set up a real club (unlike the demo seed it deletes nothing): the club, its teams,
 * and one admin who is also manager of every team, who can then sign in by email.
 */
export async function bootstrapClub(pool: Pool, input: BootstrapInput) {
  const teams = input.teams.map((spec) => {
    const [name, ageGroup, format] = spec.split(':').map((s) => s.trim());
    if (!name || !AGE_GROUPS.includes(ageGroup ?? '') || !['5', '7', '11'].includes(format ?? '')) {
      throw new Error(`Bad team "${spec}". Use Name:AgeGroup:format, e.g. "U12 Girls:U12:7" (age groups: ${AGE_GROUPS.join(', ')}; formats 5, 7, 11).`);
    }
    return { name, ageGroup: ageGroup!, format: Number(format) };
  });
  if (teams.length === 0) throw new Error('Give at least one team.');

  await migrate(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const club = (await client.query('INSERT INTO clubs (name) VALUES ($1) RETURNING id', [input.clubName])).rows[0];
    const member = (
      await client.query(
        'INSERT INTO members (club_id, first_name, last_name, email) VALUES ($1, $2, $3, lower($4)) RETURNING id',
        [club.id, input.firstName, input.lastName, input.email],
      )
    ).rows[0];
    for (const t of teams) {
      const team = (
        await client.query(
          'INSERT INTO teams (club_id, name, age_group, default_format) VALUES ($1, $2, $3, $4) RETURNING id',
          [club.id, t.name, t.ageGroup, t.format],
        )
      ).rows[0];
      await client.query('INSERT INTO team_memberships (team_id, member_id, roles) VALUES ($1, $2, $3)', [
        team.id,
        member.id,
        ['admin', 'manager'],
      ]);
    }
    await client.query('COMMIT');
    return { clubId: club.id as string, adminId: member.id as string, teams: teams.length };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function parseArgs(argv: string[]): BootstrapInput {
  const get = (flag: string) => argv.flatMap((a, i) => (a === flag ? [argv[i + 1] ?? ''] : []));
  const one = (flag: string) => {
    const v = get(flag)[0];
    if (!v) throw new Error(`Missing ${flag}`);
    return v;
  };
  return {
    clubName: one('--club'),
    firstName: one('--first'),
    lastName: one('--last'),
    email: one('--email'),
    teams: get('--team'),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pool = createPool();
  bootstrapClub(pool, parseArgs(process.argv.slice(2)))
    .then((r) => console.log(`Created club ${r.clubId} with ${r.teams} team(s). The admin can now sign in by email.`))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
