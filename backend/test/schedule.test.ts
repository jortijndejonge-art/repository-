import { describe, expect, it } from 'vitest';
import type { ClubFixture, Pitch } from '@hockey/contracts';
import type { Repository } from '../src/db/repository';
import { ScheduleService } from '../src/services/schedule';

const pitch: Pitch = {
  id: 'main',
  clubId: 'club',
  name: 'Main astro',
  slots: [{ id: 's', pitchId: 'main', weekday: 5, startMinute: 540, endMinute: 780, ageGroups: ['U12'] }],
};
const foreign: Pitch = { id: 'other', clubId: 'someone-else', name: 'Elsewhere', slots: [] };

// Saturday 3 October 2026, 10:00 local (BST) = 09:00Z
const TEN = '2026-10-03T09:00:00.000Z';

function setup(fixtures: Partial<ClubFixture>[] = []) {
  let asked: { from: Date; to: Date } | undefined;
  const repo = {
    getTeam: async (id: string) => (id === 'u12b' ? { id, clubId: 'club', name: 'U12 Boys', ageGroup: 'U12', defaultFormat: 7 } : null),
    getPitch: async (id: string) => [pitch, foreign].find((p) => p.id === id) ?? null,
    listPitches: async () => [pitch],
    listClubFixtures: async (_club: string, from: Date, to: Date) => {
      asked = { from, to };
      return fixtures as ClubFixture[];
    },
    listTrainingSessions: async () => [],
    getClubTimezone: async () => 'Europe/London',
  };
  return { service: new ScheduleService(repo as unknown as Repository), asked: () => asked };
}

describe('ScheduleService.conflictsFor', () => {
  it('is clear for a match that fits the pitch opening', async () => {
    expect(await setup().service.conflictsFor('u12b', { startsAt: TEN, durationMinutes: 40, pitchId: 'main' })).toEqual([]);
  });

  it('reports a pitch clash with another team and a team clash with its own match', async () => {
    const { service } = setup([
      { id: 'a', teamId: 'u10g', startsAt: TEN, durationMinutes: 40, pitchId: 'main' } as ClubFixture,
      { id: 'b', teamId: 'u12b', startsAt: '2026-10-03T09:20:00.000Z', durationMinutes: 40 } as ClubFixture,
    ]);
    const kinds = (await service.conflictsFor('u12b', { startsAt: TEN, durationMinutes: 40, pitchId: 'main' })).map((c) => c.kind).sort();
    expect(kinds).toEqual(['pitch', 'team']);
  });

  it('does not clash a match with itself when editing', async () => {
    const { service } = setup([{ id: 'me', teamId: 'u12b', startsAt: TEN, durationMinutes: 40, pitchId: 'main' } as ClubFixture]);
    expect(await service.conflictsFor('u12b', { id: 'me', startsAt: TEN, durationMinutes: 40, pitchId: 'main' })).toEqual([]);
  });

  it('flags a time outside the opening', async () => {
    const result = await setup().service.conflictsFor('u12b', { startsAt: '2026-10-03T15:00:00.000Z', durationMinutes: 40, pitchId: 'main' });
    expect(result.map((c) => c.kind)).toEqual(['slot']);
  });

  it("refuses another club's pitch and an unknown team", async () => {
    await expect(setup().service.conflictsFor('u12b', { startsAt: TEN, durationMinutes: 40, pitchId: 'other' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(setup().service.conflictsFor('nope', { startsAt: TEN, durationMinutes: 40 })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('treats an empty pitch id as no pitch, and only loads a few days of matches', async () => {
    const { service, asked } = setup();
    expect(await service.conflictsFor('u12b', { startsAt: TEN, durationMinutes: 40, pitchId: '' })).toEqual([]);
    const window = asked()!;
    expect(window.to.getTime() - window.from.getTime()).toBe(3 * 86_400_000);
  });
});
