import { describe, expect, it } from 'vitest';
import type { ApplyMatch, Fixture, NewFixture } from '@hockey/contracts';
import type { Repository } from '../src/db/repository';
import { LeagueService } from '../src/services/leagues';

function setup(existing: Record<string, string[]> = {}) {
  const added: { teamId: string; fixture: NewFixture }[] = [];
  const repo = {
    getLeague: async (id: string) => (id === 'L' ? { id, clubId: 'club', name: 'Season', config: {}, updatedAt: '' } : null),
    getTeam: async (id: string) =>
      ({
        u12b: { id, clubId: 'club', name: 'U12 Boys', ageGroup: 'U12', defaultFormat: 7 },
        u8g: { id, clubId: 'club', name: 'U8 Girls', ageGroup: 'U8', defaultFormat: 5 },
        stranger: { id, clubId: 'other-club', name: 'Not ours', ageGroup: 'U12', defaultFormat: 7 },
      })[id] ?? null,
    getPitch: async (id: string) => (id === 'main' ? { id, clubId: 'club', name: 'Main', slots: [] } : id === 'theirs' ? { id, clubId: 'other-club', name: 'Theirs', slots: [] } : null),
    listTeamFixtures: async (teamId: string) => (existing[teamId] ?? []).map((startsAt) => ({ id: 'x', teamId, startsAt }) as Fixture),
    addFixture: async (teamId: string, fixture: NewFixture) => {
      added.push({ teamId, fixture });
      return { id: `f${added.length}`, teamId, ...fixture } as Fixture;
    },
  };
  return { service: new LeagueService(repo as unknown as Repository), added };
}

const match = (over: Partial<ApplyMatch> = {}): ApplyMatch => ({
  teamId: 'u12b',
  opponent: 'Northgate HC U12 Boys',
  homeAway: 'home',
  startsAt: '2026-10-10T08:00:00.000Z',
  durationMinutes: 40,
  pitchId: 'main',
  venue: 'Main',
  ...over,
});

describe('LeagueService.apply', () => {
  it("creates a fixture per match using the team's usual format, with the pitch for home matches", async () => {
    const { service, added } = setup();
    const result = await service.apply('L', [match(), match({ homeAway: 'away', startsAt: '2026-10-17T09:00:00.000Z', venue: 'Northgate HC', pitchId: undefined })]);
    expect(result).toEqual({ created: 2, skipped: 0 });
    expect(added[0]!.fixture).toMatchObject({ homeAway: 'home', pitchId: 'main', format: 7, periods: 4, durationMinutes: 40 });
    expect(added[1]!.fixture).toMatchObject({ homeAway: 'away', venue: 'Northgate HC' });
    expect(added[1]!.fixture).not.toHaveProperty('pitchId');
  });

  it('never keeps a pitch on an away match', async () => {
    const { service, added } = setup();
    await service.apply('L', [match({ homeAway: 'away', pitchId: 'main' })]);
    expect(added[0]!.fixture).not.toHaveProperty('pitchId');
  });

  it('plays the youngest in two halves', async () => {
    const { service, added } = setup();
    await service.apply('L', [match({ teamId: 'u8g', durationMinutes: 30 })]);
    expect(added[0]!.fixture).toMatchObject({ periods: 2, format: 5 });
  });

  it('skips a match the team already has at that time, so applying twice is harmless', async () => {
    const { service, added } = setup({ u12b: ['2026-10-10T08:00:00.000Z'] });
    const result = await service.apply('L', [match(), match({ startsAt: '2026-10-24T08:00:00.000Z' })]);
    expect(result).toEqual({ created: 1, skipped: 1 });
    expect(added).toHaveLength(1);
    // the same plan again in one request is also only created once
    const { service: again, added: addedAgain } = setup();
    expect(await again.apply('L', [match(), match()])).toEqual({ created: 1, skipped: 1 });
    expect(addedAgain).toHaveLength(1);
  });

  it("refuses another club's team or pitch, and an unknown season plan", async () => {
    const { service } = setup();
    await expect(service.apply('L', [match({ teamId: 'stranger' })])).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.apply('L', [match({ pitchId: 'theirs' })])).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.apply('nope', [match()])).rejects.toMatchObject({ statusCode: 404 });
  });
});
