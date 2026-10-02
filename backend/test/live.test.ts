import { describe, expect, it } from 'vitest';
import type { Lineup, LiveStatus, LiveSubstitution } from '@hockey/contracts';
import type { Repository } from '../src/db/repository';
import { LiveService } from '../src/services/live';

const lineup = {
  id: 'l1',
  fixtureId: 'fx',
  formationId: 'f',
  strategy: 'manual',
  starting: [
    { slotId: 'GK', memberId: 'gk' },
    { slotId: 'LB', memberId: 'a' },
    { slotId: 'RB', memberId: 'b' },
  ],
  bench: ['c', 'd'],
  substitutions: [],
  updatedAt: '2030-01-01T00:00:00.000Z',
} as Lineup;

/** The live-match methods of the repository, held in memory. */
function fakeRepo(saved: Lineup | null = lineup) {
  let row: { status: LiveStatus; elapsedSeconds: number; resumedAt?: string } | null = null;
  const subs: LiveSubstitution[] = [];
  const minutes: Record<string, number> = {};
  const repo = {
    getLineup: async () => saved,
    getLiveMatch: async () => (row ? { ...row } : null),
    createLiveMatch: async (_id: string, at: Date) => {
      row = { status: 'running', elapsedSeconds: 0, resumedAt: at.toISOString() };
    },
    updateLiveMatch: async (_id: string, u: { status: LiveStatus; elapsedSeconds: number; resumedAt: Date | null }) => {
      if (!row || row.status === 'finished') return false;
      row = { status: u.status, elapsedSeconds: u.elapsedSeconds, ...(u.resumedAt ? { resumedAt: u.resumedAt.toISOString() } : {}) };
      return true;
    },
    listLiveSubstitutions: async () => subs.map((s) => ({ ...s })),
    addLiveSubstitution: async (_id: string, s: LiveSubstitution) => void subs.push(s),
    addSeasonMinutes: async (id: string, m: number) => void (minutes[id] = (minutes[id] ?? 0) + m),
  };
  return { repo: repo as unknown as Repository, minutes, subs };
}

function setup(saved: Lineup | null = lineup) {
  const f = fakeRepo(saved);
  let nowMs = Date.parse('2030-01-01T10:00:00Z');
  const service = new LiveService(f.repo, () => new Date(nowMs));
  return { ...f, service, advance: (seconds: number) => void (nowMs += seconds * 1000) };
}

describe('LiveService clock', () => {
  it('needs a saved lineup to start, and can only be started once', async () => {
    await expect(setup(null).service.start('fx')).rejects.toMatchObject({ statusCode: 400 });
    const { service } = setup();
    await service.start('fx');
    await expect(service.start('fx')).rejects.toMatchObject({ statusCode: 409 });
  });

  it('counts playing time while running, and stops counting while paused', async () => {
    const { service, advance } = setup();
    await service.start('fx');
    advance(600);
    expect((await service.get('fx'))!.elapsedSeconds).toBe(600);

    await service.pause('fx');
    advance(300); // a break in play: not counted
    expect(await service.get('fx')).toMatchObject({ status: 'paused', elapsedSeconds: 600 });

    await service.resume('fx');
    advance(120);
    expect(await service.get('fx')).toMatchObject({ status: 'running', elapsedSeconds: 720 });

    await expect(service.resume('fx')).rejects.toMatchObject({ statusCode: 409 });
  });

  it('returns null for a match that has not started', async () => {
    expect(await setup().service.get('fx')).toBeNull();
  });
});

describe('LiveService substitutions', () => {
  it('records a valid change at the current playing time', async () => {
    const { service, advance } = setup();
    await service.start('fx');
    advance(900);
    const state = await service.substitute('fx', 'LB', 'a', 'c');
    expect(state.substitutions).toEqual([{ atSecond: 900, slotId: 'LB', offMemberId: 'a', onMemberId: 'c' }]);
  });

  it('refuses a change for someone not in that slot, or a player already on the pitch', async () => {
    const { service } = setup();
    await service.start('fx');
    await expect(service.substitute('fx', 'LB', 'b', 'c')).rejects.toMatchObject({ statusCode: 409 }); // b plays RB
    await expect(service.substitute('fx', 'LB', 'a', 'gk')).rejects.toMatchObject({ statusCode: 409 }); // gk is already on
    await service.substitute('fx', 'LB', 'a', 'c');
    await expect(service.substitute('fx', 'RB', 'b', 'c')).rejects.toMatchObject({ statusCode: 409 }); // c is on now
    await expect(service.substitute('fx', 'RB', 'b', 'a')).resolves.toBeTruthy(); // a is back on the bench, so allowed
  });
});

describe('LiveService finish', () => {
  it('adds each player\'s minutes to their season total, exactly once', async () => {
    const { service, advance, minutes } = setup();
    await service.start('fx');
    advance(20 * 60);
    await service.substitute('fx', 'LB', 'a', 'c');
    advance(40 * 60);
    const done = await service.finish('fx');
    expect(done).toMatchObject({ status: 'finished', elapsedSeconds: 3600 });
    expect(minutes).toEqual({ gk: 60, a: 20, b: 60, c: 40 });

    advance(600);
    await service.finish('fx'); // pressed twice
    expect(minutes).toEqual({ gk: 60, a: 20, b: 60, c: 40 });
    expect((await service.get('fx'))!.elapsedSeconds).toBe(3600);
  });

  it('is over for good: no more pausing or substitutions', async () => {
    const { service } = setup();
    await service.start('fx');
    await service.finish('fx');
    await expect(service.pause('fx')).rejects.toMatchObject({ statusCode: 409 });
    await expect(service.substitute('fx', 'LB', 'a', 'c')).rejects.toMatchObject({ statusCode: 409 });
  });
});
