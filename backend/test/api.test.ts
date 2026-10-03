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

describe('training sessions', () => {
  const session = { startsAt: '2030-05-06T17:30:00.000Z', durationMinutes: 60, venue: 'Test Astro', notes: 'Bring shin pads' };

  it('lets a manager schedule, edit and delete a session', async () => {
    const coach = await signIn('coach@example.com');
    const add = await app.inject({ method: 'POST', url: '/api/v1/teams/u12/training', headers: as(coach), payload: session });
    expect(add.statusCode).toBe(201);
    const created = add.json();
    expect(created).toMatchObject({ ...session, teamId: 'u12' });

    const edit = await app.inject({ method: 'PATCH', url: `/api/v1/training/${created.id}`, headers: as(coach), payload: { venue: 'Main pitch' } });
    expect(edit.json()).toMatchObject({ venue: 'Main pitch', durationMinutes: 60 });

    const list = await app.inject({ method: 'GET', url: '/api/v1/teams/u12/training', headers: as(coach) });
    expect(list.json().map((s: { id: string }) => s.id)).toContain(created.id);

    expect((await app.inject({ method: 'DELETE', url: `/api/v1/training/${created.id}`, headers: as(coach) })).statusCode).toBe(204);
  });

  it('records RSVPs by the player and attendance by the manager', async () => {
    const coach = await signIn('coach@example.com');
    const p = await signIn(playerEmail);
    const created = (await app.inject({ method: 'POST', url: '/api/v1/teams/u12/training', headers: as(coach), payload: session })).json();
    const url = `/api/v1/training/${created.id}`;

    const before = (await app.inject({ method: 'GET', url: `${url}/responses`, headers: as(coach) })).json();
    // The live squad: an earlier test adds a player to U12.
    const squadSize = (await app.inject({ method: 'GET', url: '/api/v1/teams/u12/players', headers: as(coach) })).json().length;
    expect(before).toHaveLength(squadSize);
    expect(before.every((r: { rsvp: string }) => r.rsvp === 'no_response')).toBe(true);

    const rsvp = await app.inject({ method: 'PUT', url: `${url}/rsvp`, headers: as(p), payload: { memberId: player.memberId, status: 'available' } });
    expect(rsvp.statusCode).toBe(204);
    const otherPlayer = await app.inject({ method: 'PUT', url: `${url}/rsvp`, headers: as(p), payload: { memberId: teammate.memberId, status: 'available' } });
    expect(otherPlayer.statusCode).toBe(403);

    const selfAttend = await app.inject({ method: 'PUT', url: `${url}/attendance`, headers: as(p), payload: { memberId: player.memberId, attended: true } });
    expect(selfAttend.statusCode).toBe(403);
    const attend = await app.inject({ method: 'PUT', url: `${url}/attendance`, headers: as(coach), payload: { memberId: player.memberId, attended: true } });
    expect(attend.statusCode).toBe(204);

    const after = (await app.inject({ method: 'GET', url: `${url}/responses`, headers: as(coach) })).json();
    expect(after.find((r: { memberId: string }) => r.memberId === player.memberId)).toMatchObject({ rsvp: 'available', attended: true });

    await app.inject({ method: 'DELETE', url, headers: as(coach) });
  });

  it('refuses sessions from players and bad input', async () => {
    const p = await signIn(playerEmail);
    expect((await app.inject({ method: 'POST', url: '/api/v1/teams/u12/training', headers: as(p), payload: session })).statusCode).toBe(403);
    const coach = await signIn('coach@example.com');
    expect((await app.inject({ method: 'POST', url: '/api/v1/teams/u12/training', headers: as(coach), payload: { ...session, durationMinutes: 0 } })).statusCode).toBe(400);
  });
});

describe('announcements', () => {
  it('lets a manager post and delete, and the squad reads them newest first', async () => {
    const coach = await signIn('coach@example.com');
    const p = await signIn(playerEmail);
    const url = '/api/v1/teams/u12/announcements';

    const first = await app.inject({ method: 'POST', url, headers: as(coach), payload: { title: 'Kit', body: 'Bring the blue shirts.' } });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ title: 'Kit', teamId: 'u12' });
    expect(first.json().authorName).toBeTruthy();
    const second = await app.inject({ method: 'POST', url, headers: as(coach), payload: { title: 'Lift share', body: 'Meet at 9.' } });

    const list = (await app.inject({ method: 'GET', url, headers: as(p) })).json();
    expect(list.map((a: { title: string }) => a.title).slice(0, 2)).toEqual(['Lift share', 'Kit']);

    expect((await app.inject({ method: 'DELETE', url: `/api/v1/announcements/${first.json().id}`, headers: as(p) })).statusCode).toBe(403);
    for (const a of [first, second]) {
      expect((await app.inject({ method: 'DELETE', url: `/api/v1/announcements/${a.json().id}`, headers: as(coach) })).statusCode).toBe(204);
    }
  });

  it('refuses posts from players and empty messages', async () => {
    const p = await signIn(playerEmail);
    const url = '/api/v1/teams/u12/announcements';
    expect((await app.inject({ method: 'POST', url, headers: as(p), payload: { title: 'Hi', body: 'There' } })).statusCode).toBe(403);
    const coach = await signIn('coach@example.com');
    expect((await app.inject({ method: 'POST', url, headers: as(coach), payload: { title: '', body: 'x' } })).statusCode).toBe(400);
  });
});

describe('season stats', () => {
  it('counts attendance only for past sessions where it was recorded, and is for managers only', async () => {
    const coach = await signIn('coach@example.com');
    const p = await signIn(playerEmail);
    const post = (payload: object) => app.inject({ method: 'POST', url: '/api/v1/teams/u12/training', headers: as(coach), payload });
    const past = (await post({ startsAt: '2020-01-07T17:30:00.000Z', durationMinutes: 60, venue: 'Old Astro' })).json();
    const unrecorded = (await post({ startsAt: '2020-01-14T17:30:00.000Z', durationMinutes: 60, venue: 'Old Astro' })).json();
    const future = (await post({ startsAt: '2090-01-07T17:30:00.000Z', durationMinutes: 60, venue: 'Future Astro' })).json();

    for (const attended of [true, false]) {
      const who = attended ? player.memberId : teammate.memberId;
      const res = await app.inject({ method: 'PUT', url: `/api/v1/training/${past.id}/attendance`, headers: as(coach), payload: { memberId: who, attended } });
      expect(res.statusCode).toBe(204);
    }

    const stats = (await app.inject({ method: 'GET', url: '/api/v1/teams/u12/stats', headers: as(coach) })).json();
    const mine = stats.find((s: { memberId: string }) => s.memberId === player.memberId);
    const other = stats.find((s: { memberId: string }) => s.memberId === teammate.memberId);
    const squadSize = (await app.inject({ method: 'GET', url: '/api/v1/teams/u12/players', headers: as(coach) })).json().length;
    expect(stats).toHaveLength(squadSize);
    expect(mine).toMatchObject({ trainingAttended: 1, trainingTotal: 1 });
    expect(other).toMatchObject({ trainingAttended: 0, trainingTotal: 1 });

    expect((await app.inject({ method: 'GET', url: '/api/v1/teams/u12/stats', headers: as(p) })).statusCode).toBe(403);
    for (const s of [past, unrecorded, future]) {
      await app.inject({ method: 'DELETE', url: `/api/v1/training/${s.id}`, headers: as(coach) });
    }
  });
});

describe('event chat', () => {
  const matchChat = `/api/v1/events/match/${U12_FIXTURE}/chat`;
  const outsider = demo.members.find((m) => m.id === demo.squads.u16![3]!.memberId)!.email!;
  const post = (headers: Record<string, string>, url: string, body: string) => app.inject({ method: 'POST', url, headers, payload: { body } });

  /** The coach links a parent to `player`; returns the parent's session. */
  async function parentOfPlayer() {
    const coach = await signIn('coach@example.com');
    const link = await app.inject({
      method: 'POST',
      url: `/api/v1/teams/u12/players/${player.memberId}/guardians`,
      headers: as(coach),
      payload: { firstName: 'Pat', lastName: 'Parent', email: 'pat.parent@example.com' },
    });
    expect([200, 201]).toContain(link.statusCode);
    return signIn('pat.parent@example.com');
  }

  it('lets players, their parents and managers talk on a match, and keeps everyone else out', async () => {
    const p = await signIn(playerEmail);
    const parent = await parentOfPlayer();
    const coach = await signIn('coach@example.com');

    const mine = await post(as(p), matchChat, '  Can someone give me a lift?  ');
    expect(mine.statusCode).toBe(201);
    expect(mine.json()).toMatchObject({ body: 'Can someone give me a lift?', authorRole: 'Player' });

    // Parents see their child's schedule and join the chat.
    expect((await app.inject({ method: 'GET', url: '/api/v1/teams/u12/fixtures', headers: as(parent) })).statusCode).toBe(200);
    const reply = await post(as(parent), matchChat, 'I can take two');
    expect(reply.json()).toMatchObject({ authorName: 'Pat Parent', authorRole: `Parent of ${player.displayName}` });

    const thread = (await app.inject({ method: 'GET', url: matchChat, headers: as(coach) })).json();
    expect(thread.canModerate).toBe(true);
    expect(thread.messages.map((m: { body: string }) => m.body)).toEqual(['Can someone give me a lift?', 'I can take two']);

    // Someone from another team can't read or post, and empty messages are refused.
    const out = await signIn(outsider);
    expect((await app.inject({ method: 'GET', url: matchChat, headers: as(out) })).statusCode).toBe(403);
    expect((await post(as(out), matchChat, 'hi')).statusCode).toBe(403);
    expect((await post(as(p), matchChat, '   ')).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/v1/events/match/nope/chat', headers: as(p) })).statusCode).toBe(404);
  });

  it('counts unread messages until the chat is opened, not counting your own', async () => {
    const p = await signIn(playerEmail);
    const coach = await signIn('coach@example.com');
    await app.inject({ method: 'GET', url: matchChat, headers: as(coach) }); // caught up
    await post(as(p), matchChat, 'See you at 10');

    const unread = (await app.inject({ method: 'GET', url: '/api/v1/teams/u12/chat-unread', headers: as(coach) })).json();
    expect(unread.find((u: { eventId: string }) => u.eventId === U12_FIXTURE)).toMatchObject({ kind: 'match', unread: 1 });
    const own = (await app.inject({ method: 'GET', url: '/api/v1/teams/u12/chat-unread', headers: as(p) })).json();
    expect(own.find((u: { eventId: string }) => u.eventId === U12_FIXTURE).unread).toBe(0);

    await app.inject({ method: 'GET', url: matchChat, headers: as(coach) });
    const after = (await app.inject({ method: 'GET', url: '/api/v1/teams/u12/chat-unread', headers: as(coach) })).json();
    expect(after.find((u: { eventId: string }) => u.eventId === U12_FIXTURE).unread).toBe(0);
  });

  it('lets a manager post the saved lineup as a card with names and numbers only', async () => {
    const coach = await signIn('coach@example.com');
    const plan: SuggestionResult = (
      await app.inject({ method: 'POST', url: `/api/v1/fixtures/${U12_FIXTURE}/lineup/suggest`, headers: as(coach), payload: { formationId: '7-2-2-2', strategy: 'fair' } })
    ).json();
    await app.inject({
      method: 'PUT',
      url: `/api/v1/fixtures/${U12_FIXTURE}/lineup`,
      headers: as(coach),
      payload: { formationId: '7-2-2-2', strategy: 'fair', starting: plan.starting, bench: plan.bench, substitutions: plan.substitutions },
    });

    const p = await signIn(playerEmail);
    const url = `/api/v1/fixtures/${U12_FIXTURE}/lineup/chat`;
    expect((await app.inject({ method: 'POST', url, headers: as(p) })).statusCode).toBe(403);

    const res = await app.inject({ method: 'POST', url, headers: as(coach), payload: { note: 'Here is Saturday' } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ body: 'Here is Saturday', authorRole: 'Manager', lineup: { formation: { id: '7-2-2-2' }, opponent: 'Northgate HC' } });
    expect(res.body).not.toMatch(/skill|stamina|seasonMinutes|email/);

    // The player sees it in the chat.
    const thread = (await app.inject({ method: 'GET', url: matchChat, headers: as(p) })).json();
    const card = thread.messages.at(-1).lineup;
    expect(card.bench).toEqual(plan.bench);
    expect(card.players.length).toBe(new Set([...plan.starting.map((s) => s.memberId).filter(Boolean), ...plan.bench]).size);
    const total = Object.values(card.minutes as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(total).toBe(plan.starting.filter((s) => s.memberId).length * card.durationMinutes);

    // Needs a saved lineup.
    expect((await app.inject({ method: 'POST', url: '/api/v1/fixtures/fx-u8/lineup/chat', headers: as(coach) })).statusCode).toBe(409);
  });

  it('keeps training chats separate, and lets people remove their own messages (managers any)', async () => {
    const coach = await signIn('coach@example.com');
    const p = await signIn(playerEmail);
    const parent = await signIn('pat.parent@example.com');
    const session = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/teams/u12/training',
        headers: as(coach),
        payload: { startsAt: '2030-06-01T17:30:00.000Z', durationMinutes: 60, venue: 'Test Astro' },
      })
    ).json();
    const trainingChat = `/api/v1/events/training/${session.id}/chat`;

    const fromParent = (await post(as(parent), trainingChat, 'Running 5 minutes late')).json();
    const fromPlayer = (await post(as(p), trainingChat, 'Same')).json();
    const thread = (await app.inject({ method: 'GET', url: trainingChat, headers: as(p) })).json();
    expect(thread.canModerate).toBe(false);
    expect(thread.messages).toHaveLength(2);
    const match = (await app.inject({ method: 'GET', url: matchChat, headers: as(p) })).json();
    expect(match.messages.some((m: { body: string }) => m.body === 'Running 5 minutes late')).toBe(false);

    const del = (id: string, who: AuthSession) => app.inject({ method: 'DELETE', url: `/api/v1/chat/messages/${id}`, headers: as(who) });
    expect((await del(fromParent.id, p)).statusCode).toBe(403);
    expect((await del(fromParent.id, parent)).statusCode).toBe(204);
    expect((await del(fromPlayer.id, coach)).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: trainingChat, headers: as(p) })).json().messages).toHaveLength(0);
  });
});

describe('pitches and fixture clashes', () => {
  it('lets an admin build a pitch with weekly openings, and managers see it', async () => {
    const coach = await signIn('coach@example.com');
    const p = await signIn(playerEmail);
    const club = demo.club.id;

    const made = await app.inject({ method: 'POST', url: `/api/v1/clubs/${club}/pitches`, headers: as(coach), payload: { name: 'Test astro' } });
    expect(made.statusCode).toBe(201);
    const pitch = made.json();
    const slot = await app.inject({
      method: 'POST',
      url: `/api/v1/pitches/${pitch.id}/slots`,
      headers: as(coach),
      payload: { weekday: 5, startMinute: 540, endMinute: 780, ageGroups: ['U12', 'U12', 'U8'] },
    });
    expect(slot.statusCode).toBe(201);
    expect(slot.json().ageGroups).toEqual(['U12', 'U8']);

    expect((await app.inject({ method: 'POST', url: `/api/v1/pitches/${pitch.id}/slots`, headers: as(coach), payload: { weekday: 5, startMinute: 700, endMinute: 600, ageGroups: ['U12'] } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/api/v1/clubs/${club}/pitches`, headers: as(p), payload: { name: 'Nope' } })).statusCode).toBe(403);

    const list = (await app.inject({ method: 'GET', url: `/api/v1/clubs/${club}/pitches`, headers: as(p) })).json();
    expect(list.find((x: { id: string }) => x.id === pitch.id).slots).toHaveLength(1);

    expect((await app.inject({ method: 'DELETE', url: `/api/v1/pitches/${pitch.id}`, headers: as(coach) })).statusCode).toBe(204);
  });

  it('refuses a clashing match unless forced, and says what clashes', async () => {
    const coach = await signIn('coach@example.com');
    const club = demo.club.id;
    const pitch = (await app.inject({ method: 'POST', url: `/api/v1/clubs/${club}/pitches`, headers: as(coach), payload: { name: 'Clash astro' } })).json();
    await app.inject({ method: 'POST', url: `/api/v1/pitches/${pitch.id}/slots`, headers: as(coach), payload: { weekday: 5, startMinute: 540, endMinute: 780, ageGroups: ['U12', 'U16'] } });

    // Saturday 4 May 2030, 10:00 local (BST) = 09:00Z
    const match = { opponent: 'Clash HC', startsAt: '2030-05-04T09:00:00.000Z', venue: 'Home', homeAway: 'home', format: 7, durationMinutes: 40, periods: 4, pitchId: pitch.id };
    const first = await app.inject({ method: 'POST', url: '/api/v1/teams/u12/fixtures', headers: as(coach), payload: match });
    expect(first.statusCode).toBe(201);
    expect(first.json().pitchId).toBe(pitch.id);

    // Another team on the same pitch at the same time
    const clash = await app.inject({ method: 'POST', url: '/api/v1/teams/u16/fixtures', headers: as(coach), payload: { ...match, opponent: 'Other HC' } });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().conflicts.map((c: { kind: string }) => c.kind)).toContain('pitch');

    const dry = await app.inject({ method: 'POST', url: '/api/v1/teams/u16/fixture-conflicts', headers: as(coach), payload: { startsAt: match.startsAt, durationMinutes: 40, pitchId: pitch.id } });
    expect(dry.statusCode).toBe(200);
    expect(dry.json().length).toBeGreaterThan(0);

    const forced = await app.inject({ method: 'POST', url: '/api/v1/teams/u16/fixtures?force=true', headers: as(coach), payload: { ...match, opponent: 'Other HC' } });
    expect(forced.statusCode).toBe(201);

    // Editing the first match to a free time works, and it does not clash with itself
    const edit = await app.inject({ method: 'PATCH', url: `/api/v1/fixtures/${first.json().id}`, headers: as(coach), payload: { venue: 'Home pitch' } });
    expect(edit.statusCode).toBe(409); // still overlapping the forced one
    const move = await app.inject({ method: 'PATCH', url: `/api/v1/fixtures/${first.json().id}`, headers: as(coach), payload: { startsAt: '2030-05-04T10:00:00.000Z' } });
    expect(move.statusCode).toBe(200);

    for (const id of [first.json().id, forced.json().id]) await app.inject({ method: 'DELETE', url: `/api/v1/fixtures/${id}`, headers: as(coach) });
    await app.inject({ method: 'DELETE', url: `/api/v1/pitches/${pitch.id}`, headers: as(coach) });
  });

  it('shows managers the whole club schedule but not players', async () => {
    const coach = await signIn('coach@example.com');
    const p = await signIn(playerEmail);
    const url = `/api/v1/clubs/${demo.club.id}/schedule?from=${encodeURIComponent('2020-01-01T00:00:00Z')}&to=${encodeURIComponent('2090-01-01T00:00:00Z')}`;
    const res = await app.inject({ method: 'GET', url, headers: as(coach) });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0]).toHaveProperty('teamName');
    expect((await app.inject({ method: 'GET', url, headers: as(p) })).statusCode).toBe(403);
  });
});
