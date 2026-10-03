import { describe, expect, it } from 'vitest';
import type { LeagueConfig, Pitch } from '@hockey/contracts';
import { leagueToSeasonInput, ourMatches, planSeason, seasonDates, usualMinutes, type OurClub } from '../src';

const TZ = 'Europe/London';

const ourPitch: Pitch = {
  id: 'main',
  clubId: 'club',
  name: 'Main astro',
  slots: [{ id: 's', pitchId: 'main', weekday: 5, startMinute: 540, endMinute: 780, ageGroups: ['U12'] }],
};
const ours: OurClub = { clubId: 'club', clubName: 'Our HC', pitches: [ourPitch], teams: [{ id: 'u12b', name: 'U12 Boys', ageGroup: 'U12' }] };

const saturdayOpening = { weekday: 5, startMinute: 540, endMinute: 780, ageGroups: ['U12' as const] };
const config: LeagueConfig = {
  firstDate: '2026-10-03',
  lastDate: '2026-12-19',
  weekday: 5,
  excludedDates: ['2026-10-31'],
  doubleRound: true,
  divisions: [{ name: 'U12 Boys', ageGroup: 'U12', ourTeamId: 'u12b' }],
  opponents: [
    { id: 'north', name: 'Northgate HC', miles: 12, slots: [saturdayOpening], divisions: ['U12 Boys'] },
    { id: 'south', name: 'Southdown HC', miles: 20, slots: [saturdayOpening], divisions: ['U12 Boys'] },
    { id: 'west', name: 'Westbrook HC', miles: 8, slots: [saturdayOpening], divisions: ['U12 Boys', 'Other'] },
  ],
};

describe('seasonDates', () => {
  it('lists the chosen weekday between the first and last date, skipping excluded dates', () => {
    const dates = seasonDates({ firstDate: '2026-10-03', lastDate: '2026-11-07', weekday: 5, excludedDates: ['2026-10-31'] });
    expect(dates).toEqual(['2026-10-03', '2026-10-10', '2026-10-17', '2026-10-24', '2026-11-07']);
  });

  it('starts on the first matching day after the first date, and works for other weekdays', () => {
    expect(seasonDates({ firstDate: '2026-10-05', lastDate: '2026-10-25', weekday: 6, excludedDates: [] })).toEqual(['2026-10-11', '2026-10-18', '2026-10-25']);
    expect(seasonDates({ firstDate: '2026-10-05', lastDate: '2026-10-04', weekday: 6, excludedDates: [] })).toEqual([]);
  });
});

describe('usualMinutes', () => {
  it('is shorter for the youngest and longer for adults', () => {
    expect([usualMinutes('U8'), usualMinutes('U12'), usualMinutes('U14'), usualMinutes('Adult')]).toEqual([30, 40, 50, 60]);
  });
});

describe('leagueToSeasonInput', () => {
  const plan = leagueToSeasonInput(config, ours, TZ);

  it('puts our team and each opponent that enters the division into it', () => {
    expect(plan.input.teams.map((t) => t.id).sort()).toEqual(['north:U12 Boys', 'south:U12 Boys', 'u12b', 'west:U12 Boys']);
    expect(plan.input.clubs.map((c) => c.name)).toEqual(['Our HC', 'Northgate HC', 'Southdown HC', 'Westbrook HC']);
    expect(plan.names.teams.get('north:U12 Boys')).toBe('Northgate HC U12 Boys');
  });

  it('uses the match length given, or the usual one', () => {
    expect(plan.input.durationMinutes('U12')).toBe(40);
    const custom = leagueToSeasonInput({ ...config, divisions: [{ ...config.divisions[0]!, durationMinutes: 45 }] }, ours, TZ);
    expect(custom.input.durationMinutes('U12')).toBe(45);
  });

  it('measures distance from our club, and estimates it between two other clubs', () => {
    const d = plan.input.distance!;
    expect(d('ours', 'north')).toBe(12);
    expect(d('south', 'ours')).toBe(20);
    expect(d('north', 'south')).toBe(8);
  });
});

describe('planning a whole league and applying it', () => {
  const plan = leagueToSeasonInput(config, ours, TZ);
  const result = planSeason({ ...plan.input, attempts: 30 });

  it('places every match: 4 teams, home and away, in the 11 Saturdays available', () => {
    expect(plan.input.dates).toHaveLength(11);
    expect(result.unplanned).toEqual([]);
    expect(result.matches).toHaveLength(12);
  });

  it("gives us six fixtures: three at home on our pitch, three away at the opponents' grounds", () => {
    const mine = ourMatches(result, plan, ours);
    expect(mine).toHaveLength(6);
    const home = mine.filter((m) => m.homeAway === 'home');
    const away = mine.filter((m) => m.homeAway === 'away');
    expect(home).toHaveLength(3);
    expect(away).toHaveLength(3);
    for (const m of home) {
      expect(m).toMatchObject({ teamId: 'u12b', pitchId: 'main', venue: 'Main astro' });
      expect(['Northgate HC U12 Boys', 'Southdown HC U12 Boys', 'Westbrook HC U12 Boys']).toContain(m.opponent);
    }
    for (const m of away) {
      expect(m.pitchId).toBeUndefined();
      expect(['Northgate HC', 'Southdown HC', 'Westbrook HC']).toContain(m.venue);
      expect(m.opponent).toBe(`${m.venue} U12 Boys`);
    }
    expect(new Set(mine.map((m) => m.startsAt)).size).toBe(6); // never two matches at once for our team
  });

  it('counts the miles our team travels', () => {
    const ourStats = result.stats.find((s) => s.teamId === 'u12b')!;
    expect(ourStats).toMatchObject({ played: 6, home: 3, away: 3 });
    expect(ourStats.awayMiles).toBe(12 + 20 + 8);
  });
});
