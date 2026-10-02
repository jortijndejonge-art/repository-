import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AuthSession, Availability, Lineup, Me, PlayerProfile, SuggestionResult } from '@hockey/contracts';
import * as demo from '@hockey/demo';
import { buildApp } from '../src/app';
import { createPool, type Pool } from '../src/db/pool';
import { PgRepository } from '../src/db/repository';
import { seed } from '../src/db/seed';
import { MemoryMailer } from '../src/services/mailer';

/**
 * Integration tests against a real Postgres. Point TEST_DATABASE_URL at a
 * throwaway database — it is wiped and re-seeded.
 */
const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres://hockey:hockey@localhost:5432/hockey_test';

let pool: Pool;
let app: FastifyInstance;
let mailer: MemoryMailer;

const U12_FIXTURE = 'fx-u12';
const u12Players = demo.squads.u12!;
const player = u12Players[3]!;
const teammate = u12Players[4]!;
const playerEmail = demo.members.find((m) => m.id === player.memberId)!.email!;

function tokenFrom(link: string) {
  return new URL(link).searchParams.get('token')!;
}

async function signIn(email: string): Promise<AuthSession> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/magic-link', payload: { email } });
  expect(res.statusCode).toBe(202);
  const verify = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/magic-link/verify',
    payload: { token: tokenFrom(res.json().devLink) },
  });
  expect(verify.statusCode).toBe(200);
  return verify.json();
}

const as = (session: AuthSession) => ({ authorization: `Bearer ${session.accessToken}` });

beforeAll(async () => {
  pool = createPool(TEST_DB);
  await seed(pool);
});

beforeEach(() => {
  mailer = new MemoryMailer();
  app = buildApp({
    repo: new PgRepository(pool),
    mailer,
    config: { appUrl: 'http://app.test', magicLinkTtlMinutes: 15, sessionTtlDays: 30, exposeDevLinks: true },
  });
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

describe('magic-link auth', () => {
  it('emails a one-time link and exchanges it for a session', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/magic-link', payload: { email: 'COACH@example.com' } });
    expect(res.statusCode).toBe(202);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.to).toBe('coach@example.com');
    expect(mailer.sent[0]!.text).toContain('http://app.test/auth/verify?token=');

    const token = tokenFrom(res.json().devLink);
    const verify = await app.inject({ method: 'POST', url: '/api/v1/auth/magic-link/verify', payload: { token } });
    expect(verify.statusCode).toBe(200);
    const session: AuthSession = verify.json();
    expect(session.me.member.id).toBe('coach');
    expect(session.me.teams).toHaveLength(4);

    // Links only work once.
    const again = await app.inject({ method: 'POST', url: '/api/v1/auth/magic-link/verify', payload: { token } });
    expect(again.statusCode).toBe(401);
  });

  it('does not reveal whether an email is registered', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/magic-link', payload: { email: 'nobody@example.com' } });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ sent: true });
    expect(mailer.sent).toHaveLength(0);
  });

  it('rejects missing or bad tokens and supports sign-out', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/me' })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/me', headers: { authorization: 'Bearer nope' } })).statusCode,
    ).toBe(401);

    const session = await signIn(playerEmail);
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: as(session) });
    expect((me.json() as Me).memberships).toEqual([{ teamId: 'u12', memberId: player.memberId, roles: ['player'] }]);

    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: as(session) })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/v1/me', headers: as(session) })).statusCode).toBe(401);
  });

  it('lets a manager invite a player by magic link', async () => {
    const coach = await signIn('coach@example.com');
    mailer.sent.length = 0;
    const res = await app.inject({ method: 'POST', url: `/api/v1/members/${player.memberId}/invite`, headers: as(coach) });
    expect(res.statusCode).toBe(202);
    expect(mailer.sent[0]!.to).toBe(playerEmail);
    expect(mailer.sent[0]!.subject).toMatch(/added to Demo Hockey Club/);

    const p = await signIn(playerEmail);
    const denied = await app.inject({ method: 'POST', url: `/api/v1/members/${teammate.memberId}/invite`, headers: as(p) });
    expect(denied.statusCode).toBe(403);
  });
});

describe('teams and players', () => {
  it('lists club teams only for club members', async () => {
    const coach = await signIn('coach@example.com');
    const res = await app.inject({ method: 'GET', url: `/api/v1/clubs/${demo.club.id}/teams`, headers: as(coach) });
    expect(res.json().map((t: { id: string }) => t.id).sort()).toEqual(['mens2', 'u12', 'u16', 'u8']);
    const other = await app.inject({ method: 'GET', url: '/api/v1/clubs/other-club/teams', headers: as(coach) });
    expect(other.statusCode).toBe(403);
  });

  it('lets a manager add and edit players, but not a player', async () => {
    const coach = await signIn('coach@example.com');
    const add = await app.inject({
      method: 'POST',
      url: '/api/v1/teams/u12/players',
      headers: as(coach),
      payload: { firstName: 'Nia', lastName: 'Walker', positions: ['MID', 'FWD'], skill: 6, stamina: 8, shirtNumber: 21 },
    });
    expect(add.statusCode).toBe(201);
    const created: PlayerProfile = add.json();
    expect(created.displayName).toBe('Nia W.');

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/teams/u12/players/${created.memberId}`,
      headers: as(coach),
      payload: { skill: 9, positions: ['FWD'] },
    });
    expect(patch.json()).toMatchObject({ skill: 9, positions: ['FWD'], stamina: 8 });

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/teams/u12/players',
      headers: as(coach),
      payload: { firstName: 'X', lastName: 'Y', positions: ['STRIKER'], skill: 11, stamina: 5 },
    });
    expect(invalid.statusCode).toBe(400);

    const p = await signIn(playerEmail);
    const denied = await app.inject({
      method: 'PATCH',
      url: `/api/v1/teams/u12/players/${teammate.memberId}`,
      headers: as(p),
      payload: { skill: 10 },
    });
    expect(denied.statusCode).toBe(403);

    const squad = await app.inject({ method: 'GET', url: '/api/v1/teams/u12/players', headers: as(p) });
    expect(squad.json().length).toBe(u12Players.length + 1);
    expect((await app.inject({ method: 'GET', url: '/api/v1/teams/u16/players', headers: as(p) })).statusCode).toBe(403);
  });
});

describe('availability', () => {
  it('returns the whole squad and lets players set their own', async () => {
    const p = await signIn(playerEmail);
    const list = await app.inject({ method: 'GET', url: `/api/v1/fixtures/${U12_FIXTURE}/availability`, headers: as(p) });
    const rows: Availability[] = list.json();
    expect(rows.length).toBeGreaterThanOrEqual(u12Players.length);

    const set = await app.inject({
      method: 'PUT',
      url: `/api/v1/fixtures/${U12_FIXTURE}/availability`,
      headers: as(p),
      payload: { memberId: player.memberId, status: 'unavailable', note: 'Away at a wedding' },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json()).toMatchObject({ status: 'unavailable', note: 'Away at a wedding' });

    const forOther = await app.inject({
      method: 'PUT',
      url: `/api/v1/fixtures/${U12_FIXTURE}/availability`,
      headers: as(p),
      payload: { memberId: teammate.memberId, status: 'unavailable' },
    });
    expect(forOther.statusCode).toBe(403);

    const coach = await signIn('coach@example.com');
    const byManager = await app.inject({
      method: 'PUT',
      url: `/api/v1/fixtures/${U12_FIXTURE}/availability`,
      headers: as(coach),
      payload: { memberId: player.memberId, status: 'available' },
    });
    expect(byManager.statusCode).toBe(200);
  });
});

describe('lineups', () => {
  it('suggests, saves, reads and shares a lineup', async () => {
    const coach = await signIn('coach@example.com');
    const suggest = await app.inject({
      method: 'POST',
      url: `/api/v1/fixtures/${U12_FIXTURE}/lineup/suggest`,
      headers: as(coach),
      payload: { formationId: '7-2-2-2', strategy: 'fair', locked: [{ slotId: 'LF', memberId: player.memberId }] },
    });
    expect(suggest.statusCode).toBe(200);
    const result: SuggestionResult = suggest.json();
    expect(result.starting.find((s) => s.slotId === 'LF')!.memberId).toBe(player.memberId);

    // Nothing saved yet, so sharing is refused.
    const early = await app.inject({ method: 'POST', url: `/api/v1/fixtures/${U12_FIXTURE}/lineup/share`, headers: as(coach) });
    expect(early.statusCode).toBe(409);

    const save = await app.inject({
      method: 'PUT',
      url: `/api/v1/fixtures/${U12_FIXTURE}/lineup`,
      headers: as(coach),
      payload: { formationId: '7-2-2-2', strategy: 'fair', starting: result.starting, bench: result.bench, substitutions: result.substitutions },
    });
    expect(save.statusCode).toBe(200);
    const saved: Lineup = save.json();
    expect(saved.substitutions).toEqual(result.substitutions);

    const p = await signIn(playerEmail);
    const read = await app.inject({ method: 'GET', url: `/api/v1/fixtures/${U12_FIXTURE}/lineup`, headers: as(p) });
    expect(read.json()).toMatchObject({ formationId: '7-2-2-2', bench: result.bench });

    mailer.sent.length = 0;
    const share = await app.inject({
      method: 'POST',
      url: `/api/v1/fixtures/${U12_FIXTURE}/lineup/share`,
      headers: as(coach),
      payload: { memberIds: [player.memberId] },
    });
    expect(share.statusCode).toBe(202);
    expect(share.json()).toEqual({ sharedWith: 1 });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.text).toContain("You're starting at LF");

    const after = await app.inject({ method: 'GET', url: `/api/v1/fixtures/${U12_FIXTURE}/lineup`, headers: as(coach) });
    expect(after.json().sharedAt).toBeTruthy();
  });

  it('rejects invalid lineups and non-managers', async () => {
    const coach = await signIn('coach@example.com');
    const bad = await app.inject({
      method: 'PUT',
      url: `/api/v1/fixtures/${U12_FIXTURE}/lineup`,
      headers: as(coach),
      payload: {
        formationId: '7-2-2-2',
        strategy: 'manual',
        starting: [{ slotId: 'LF', memberId: 'u16-p1' }],
        bench: [],
        substitutions: [],
      },
    });
    expect(bad.statusCode).toBe(400);

    const dup = await app.inject({
      method: 'PUT',
      url: `/api/v1/fixtures/${U12_FIXTURE}/lineup`,
      headers: as(coach),
      payload: {
        formationId: '7-2-2-2',
        strategy: 'manual',
        starting: [{ slotId: 'LF', memberId: player.memberId }],
        bench: [player.memberId],
        substitutions: [],
      },
    });
    expect(dup.statusCode).toBe(400);

    const p = await signIn(playerEmail);
    const denied = await app.inject({
      method: 'POST',
      url: `/api/v1/fixtures/${U12_FIXTURE}/lineup/suggest`,
      headers: as(p),
      payload: { formationId: '7-2-2-2', strategy: 'fair' },
    });
    expect(denied.statusCode).toBe(403);

    const missing = await app.inject({ method: 'GET', url: '/api/v1/fixtures/nope/lineup', headers: as(coach) });
    expect(missing.statusCode).toBe(404);
  });

  it('serves formations by format', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/formations?format=11' });
    expect(res.json().every((f: { format: number }) => f.format === 11)).toBe(true);
  });
});

describe('custom formations', () => {
  it('lets a manager save a custom formation and use it to suggest a lineup', async () => {
    const coach = await signIn('coach@example.com');
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/teams/u12/formations',
      headers: as(coach),
      payload: { name: '3-2-3-2 + GK', lines: [3, 2, 3, 2] },
    });
    expect(create.statusCode).toBe(201);
    const formation = create.json();
    expect(formation.format).toBe(11);
    expect(formation.slots).toHaveLength(11);
    expect(formation.slots.filter((s: { line: string }) => s.line === 'GK')).toHaveLength(1);

    const list = await app.inject({ method: 'GET', url: '/api/v1/teams/u12/formations', headers: as(coach) });
    expect(list.json().map((f: { id: string }) => f.id)).toContain(formation.id);

    const suggest = await app.inject({
      method: 'POST',
      url: `/api/v1/fixtures/${U12_FIXTURE}/lineup/suggest`,
      headers: as(coach),
      payload: { formationId: formation.id, strategy: 'fair' },
    });
    expect(suggest.statusCode).toBe(200);
    expect(Object.keys(suggest.json().projectedMinutes).length).toBeGreaterThan(0);
  });

  it('rejects line counts that do not total 5, 7, or 11, and blocks non-managers', async () => {
    const coach = await signIn('coach@example.com');
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/teams/u12/formations',
      headers: as(coach),
      payload: { name: 'Too many', lines: [4, 4, 4] },
    });
    expect(invalid.statusCode).toBe(400);

    const p = await signIn(playerEmail);
    const denied = await app.inject({
      method: 'POST',
      url: '/api/v1/teams/u12/formations',
      headers: as(p),
      payload: { name: '4-3-3 + GK', lines: [4, 3, 3] },
    });
    expect(denied.statusCode).toBe(403);
  });
});

describe('formation layouts', () => {
  it("saves, lists and resets a team's adjusted positions for a built-in formation", async () => {
    const coach = await signIn('coach@example.com');
    const url = '/api/v1/teams/u12/formation-layouts';
    const save = await app.inject({
      method: 'PUT',
      url: `${url}/11-4-3-3`,
      headers: as(coach),
      payload: { positions: { LW: { x: 10, y: 15 } } },
    });
    expect(save.statusCode).toBe(200);
    expect(save.json()).toEqual({ formationId: '11-4-3-3', positions: { LW: { x: 10, y: 15 } } });

    const list = await app.inject({ method: 'GET', url, headers: as(coach) });
    expect(list.json()).toContainEqual({ formationId: '11-4-3-3', positions: { LW: { x: 10, y: 15 } } });

    const reset = await app.inject({ method: 'DELETE', url: `${url}/11-4-3-3`, headers: as(coach) });
    expect(reset.statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url, headers: as(coach) })).json()).toEqual([]);
  });

  it('rejects unknown positions, out-of-range coordinates, and non-managers', async () => {
    const coach = await signIn('coach@example.com');
    const url = '/api/v1/teams/u12/formation-layouts/11-4-3-3';
    const badSlot = await app.inject({ method: 'PUT', url, headers: as(coach), payload: { positions: { XX: { x: 1, y: 1 } } } });
    expect(badSlot.statusCode).toBe(400);
    const badCoord = await app.inject({ method: 'PUT', url, headers: as(coach), payload: { positions: { LW: { x: 120, y: 1 } } } });
    expect(badCoord.statusCode).toBe(400);

    const p = await signIn(playerEmail);
    const denied = await app.inject({ method: 'PUT', url, headers: as(p), payload: { positions: { LW: { x: 1, y: 1 } } } });
    expect(denied.statusCode).toBe(403);
  });
});

describe('fixtures', () => {
  const newFixture = {
    opponent: 'Test Town HC',
    startsAt: '2030-05-04T10:00:00.000Z',
    venue: 'Test Astro',
    homeAway: 'home',
    format: 7,
    durationMinutes: 40,
    periods: 4,
  };

  it('lets a manager add, edit and delete a fixture', async () => {
    const coach = await signIn('coach@example.com');
    const add = await app.inject({ method: 'POST', url: '/api/v1/teams/u12/fixtures', headers: as(coach), payload: newFixture });
    expect(add.statusCode).toBe(201);
    const created = add.json();
    expect(created).toMatchObject({ ...newFixture, teamId: 'u12' });

    const edit = await app.inject({
      method: 'PATCH',
      url: `/api/v1/fixtures/${created.id}`,
      headers: as(coach),
      payload: { opponent: 'Renamed HC', homeAway: 'away' },
    });
    expect(edit.statusCode).toBe(200);
    expect(edit.json()).toMatchObject({ opponent: 'Renamed HC', homeAway: 'away', venue: 'Test Astro' });

    const list = await app.inject({ method: 'GET', url: '/api/v1/teams/u12/fixtures', headers: as(coach) });
    expect(list.json().map((f: { id: string }) => f.id)).toContain(created.id);

    const del = await app.inject({ method: 'DELETE', url: `/api/v1/fixtures/${created.id}`, headers: as(coach) });
    expect(del.statusCode).toBe(204);
    const after = await app.inject({ method: 'GET', url: '/api/v1/teams/u12/fixtures', headers: as(coach) });
    expect(after.json().map((f: { id: string }) => f.id)).not.toContain(created.id);
  });

  it('rejects bad input and players who are not managers', async () => {
    const coach = await signIn('coach@example.com');
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/teams/u12/fixtures',
      headers: as(coach),
      payload: { ...newFixture, format: 9 },
    });
    expect(bad.statusCode).toBe(400);

    const p = await signIn(playerEmail);
    const denied = await app.inject({ method: 'POST', url: '/api/v1/teams/u12/fixtures', headers: as(p), payload: newFixture });
    expect(denied.statusCode).toBe(403);
    const deniedDelete = await app.inject({ method: 'DELETE', url: `/api/v1/fixtures/${U12_FIXTURE}`, headers: as(p) });
    expect(deniedDelete.statusCode).toBe(403);
  });
});
