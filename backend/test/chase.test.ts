import { describe, expect, it } from 'vitest';
import type { Availability, Fixture, PlayerProfile } from '@hockey/contracts';
import type { Repository } from '../src/db/repository';
import { ChaseService } from '../src/services/chase';
import { MemoryMailer } from '../src/services/mailer';

const NOW = new Date('2030-03-01T10:00:00Z');
const hours = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

const fixture = (id: string, startsInHours: number): Fixture => ({
  id,
  teamId: 'u12',
  opponent: `Opp ${id}`,
  startsAt: hours(startsInHours),
  venue: 'Astro',
  homeAway: 'home',
  format: 7,
  durationMinutes: 40,
  periods: 4,
});

const player = (memberId: string, displayName: string): PlayerProfile => ({ memberId, displayName, positions: ['MID'], skill: 5, stamina: 5, seasonMinutes: 0 });

function setup(opts: { answered?: Record<string, Availability['status']>; fixtures?: Fixture[] } = {}) {
  const fixtures = opts.fixtures ?? [fixture('f1', 24)];
  const squad = [player('a', 'Ann A.'), player('b', 'Bo B.'), player('c', 'Cy C.')];
  const members: Record<string, { email?: string; firstName: string }> = { a: { firstName: 'Ann', email: 'ann@x.com' }, b: { firstName: 'Bo' }, c: { firstName: 'Cy', email: 'cy@x.com' } };
  const guardians: Record<string, { email?: string; firstName: string }[]> = { b: [{ firstName: 'Pat', email: 'pat@x.com' }], c: [{ firstName: 'Pat', email: 'pat@x.com' }] };
  const messages: { body: string; system?: boolean; authorId: string | null }[] = [];
  const chased = new Map<string, Date>();
  const repo = {
    getFixture: async (id: string) => fixtures.find((f) => f.id === id) ?? null,
    getTeam: async () => ({ id: 'u12', clubId: 'c', name: 'U12 Boys', ageGroup: 'U12', defaultFormat: 7 }),
    listTeamPlayers: async () => squad,
    listAvailability: async (fixtureId: string) =>
      Object.entries(opts.answered ?? {}).map(([memberId, status]) => ({ fixtureId, memberId, status, updatedAt: '' })),
    getMember: async (id: string) => members[id],
    listGuardians: async (id: string) => (guardians[id] ?? []).map((g, i) => ({ memberId: `g${id}${i}`, lastName: 'X', ...g })),
    claimChase: async (id: string, at: Date, notSince: Date) => {
      const last = chased.get(id);
      if (last && last >= notSince) return false;
      chased.set(id, at);
      return true;
    },
    addEventMessage: async (m: { body: string; system?: boolean; authorId: string | null }) => {
      messages.push(m);
      return m;
    },
    listFixturesBetween: async (from: Date, to: Date) => fixtures.filter((f) => f.startsAt >= from.toISOString() && f.startsAt < to.toISOString()),
  };
  const mailer = new MemoryMailer();
  const make = (emailEnabled: boolean) => new ChaseService(repo as unknown as Repository, mailer, 'https://club.test/myhockey/', emailEnabled, () => NOW);
  return { make, mailer, messages, chased };
}

describe('ChaseService.waitingOn', () => {
  it('lists players with no answer; a "no_response" row counts as no answer', async () => {
    const { make } = setup({ answered: { a: 'available', b: 'no_response' } });
    expect((await make(false).waitingOn('f1')).map((p) => p.displayName)).toEqual(['Bo B.', 'Cy C.']);
  });
});

describe('ChaseService.chase', () => {
  it('posts one automatic reminder in the match chat naming who is still to answer', async () => {
    const { make, messages } = setup({ answered: { a: 'available' } });
    const result = await make(false).chase('f1');
    expect(result).toEqual({ reminded: 2, names: ['Bo B.', 'Cy C.'] });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ system: true, authorId: null });
    expect(messages[0]!.body).toContain('U12 Boys v Opp f1');
    expect(messages[0]!.body).toContain('Still waiting on Bo B., Cy C.');
  });

  it('does nothing when everyone has answered, and does not use up the daily reminder', async () => {
    const { make, messages, chased } = setup({ answered: { a: 'available', b: 'maybe', c: 'unavailable' } });
    expect(await make(false).chase('f1')).toEqual({ reminded: 0, names: [] });
    expect(messages).toHaveLength(0);
    expect(chased.size).toBe(0);
  });

  it('will not remind about the same match twice in a day, but a manager can ask again after an hour', async () => {
    const { make, messages } = setup();
    const service = make(false);
    await service.chase('f1');
    await expect(service.chase('f1')).rejects.toMatchObject({ statusCode: 409 });
    await expect(service.chase('f1', { force: true })).rejects.toMatchObject({ statusCode: 409 }); // under an hour ago
    expect(messages).toHaveLength(1);
  });

  it('emails players and parents only when email is set up, once each even if a parent has two children waiting', async () => {
    const off = setup();
    await off.make(false).chase('f1');
    expect(off.mailer.sent).toHaveLength(0);

    const on = setup();
    await on.make(true).chase('f1');
    expect(on.mailer.sent.map((m) => m.to).sort()).toEqual(['ann@x.com', 'cy@x.com', 'pat@x.com']);
    const parent = on.mailer.sent.find((m) => m.to === 'pat@x.com')!;
    expect(parent.text).toContain('whether Bo B. can play'); // the first child it found; one email, not two
    expect(parent.text).toContain('https://club.test/myhockey/');
  });

  it('still posts the reminder, and emails the others, when one email cannot be sent', async () => {
    const { make, mailer, messages } = setup();
    const original = mailer.send.bind(mailer);
    mailer.send = async (mail) => {
      if (mail.to === 'ann@x.com') throw new Error('mailbox unavailable');
      return original(mail);
    };
    const result = await make(true).chase('f1');
    expect(result.reminded).toBe(3);
    expect(messages).toHaveLength(1);
    expect(mailer.sent.map((m) => m.to).sort()).toEqual(['cy@x.com', 'pat@x.com']);
  });

  it('refuses a match that does not exist', async () => {
    await expect(setup().make(false).chase('nope')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('ChaseService.chaseUpcoming', () => {
  it('reminds only for matches in the next three days, once each', async () => {
    const { make, messages } = setup({ fixtures: [fixture('soon', 24), fixture('later', 24 * 10), fixture('past', -5)] });
    const service = make(false);
    expect(await service.chaseUpcoming()).toBe(1);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.body).toContain('Opp soon');
    expect(await service.chaseUpcoming()).toBe(0); // already reminded today
    expect(messages).toHaveLength(1);
  });
});
