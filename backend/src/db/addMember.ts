import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config';
import { AuthService } from '../services/auth';
import { ConsoleMailer } from '../services/mailer';
import { createPool, type Pool } from './pool';
import { PgRepository } from './repository';

const ROLES = ['manager', 'guardian', 'player', 'admin'];

export interface AddMemberInput {
  clubName: string;
  teamName: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
}

/** Add a person to an existing team with one role (e.g. a manager or a parent), without touching anyone else. */
export async function addMember(pool: Pool, input: AddMemberInput) {
  if (!ROLES.includes(input.role)) throw new Error(`Role must be one of: ${ROLES.join(', ')}`);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const team = (
      await client.query(
        'SELECT t.id, t.club_id FROM teams t JOIN clubs c ON c.id = t.club_id WHERE c.name = $1 AND t.name = $2',
        [input.clubName, input.teamName],
      )
    ).rows[0];
    if (!team) throw new Error(`No team "${input.teamName}" in club "${input.clubName}"`);
    const member = (
      await client.query(
        'INSERT INTO members (club_id, first_name, last_name, email) VALUES ($1, $2, $3, lower($4)) RETURNING id',
        [team.club_id, input.firstName, input.lastName, input.email],
      )
    ).rows[0];
    await client.query('INSERT INTO team_memberships (team_id, member_id, roles) VALUES ($1, $2, $3)', [
      team.id,
      member.id,
      [input.role],
    ]);
    await client.query('COMMIT');
    return member.id as string;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const one = (flag: string) => {
    const v = argv[argv.indexOf(flag) + 1];
    if (argv.indexOf(flag) < 0 || !v) throw new Error(`Missing ${flag}`);
    return v;
  };
  const pool = createPool();
  (async () => {
    const input = {
      clubName: one('--club'),
      teamName: one('--team'),
      firstName: one('--first'),
      lastName: one('--last'),
      email: one('--email'),
      role: one('--role'),
    };
    await addMember(pool, input);
    const auth = new AuthService(new PgRepository(pool), new ConsoleMailer(), loadConfig());
    const password = await auth.setPasswordForEmail(input.email);
    console.log(`Added ${input.email} to ${input.teamName} as ${input.role}. Password: ${password}`);
  })()
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
