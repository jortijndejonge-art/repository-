import { describe, expect, it } from 'vitest';
import type { AgeGroup, Pitch } from '@hockey/contracts';
import { instantAt, planSeason, roundRobin, type SeasonClub, type SeasonInput, type SeasonTeam } from '../src';

const TZ = 'Europe/London';
// Saturdays in October and November 2026
const SATURDAYS = ['2026-10-03', '2026-10-10', '2026-10-17', '2026-10-24', '2026-10-31', '2026-11-07', '2026-11-14', '2026-11-21'];

const pitch = (id: string, clubId: string, slots: { start: number; end: number; groups: AgeGroup[]; weekday?: number }[]): Pitch => ({
  id,
  clubId,
  name: id,
  slots: slots.map((s, i) => ({ id: `${id}-s${i}`, pitchId: id, weekday: s.weekday ?? 5, startMinute: s.start, endMinute: s.end, ageGroups: s.groups })),
});

/** `n` clubs, each with one pitch open on Saturdays 09:00-13:00 for the given age groups, and one team per division. */
function league(n: number, divisions: { name: string; ageGroup: AgeGroup }[] = [{ name: 'U12 Boys', ageGroup: 'U12' }], opts: Partial<SeasonInput> = {}): SeasonInput {
  const clubs: SeasonClub[] = Array.from({ length: n }, (_, i) => ({
    id: `c${i + 1}`,
    name: `Club ${i + 1}`,
    pitches: [pitch(`p${i + 1}`, `c${i + 1}`, [{ start: 540, end: 780, groups: divisions.map((d) => d.ageGroup) }])],
  }));
  const teams: SeasonTeam[] = clubs.flatMap((c) => divisions.map((d) => ({ id: `${c.id}-${d.name}`, clubId: c.id, name: `${c.name} ${d.name}`, division: d.name, ageGroup: d.ageGroup })));
  return { clubs, teams, dates: SATURDAYS, durationMinutes: () => 40, doubleRound: false, timeZone: TZ, attempts: 20, ...opts };
}

describe('roundRobin', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${i + 1}`);

  it('makes n-1 rounds for an even number of teams, every team once per round, every pair once', () => {
    const rounds = roundRobin(ids(6));
    expect(rounds).toHaveLength(5);
    const pairs = new Set<string>();
    for (const round of rounds) {
      expect(round).toHaveLength(3);
      expect(new Set(round.flat()).size).toBe(6);
      for (const [a, b] of round) pairs.add([a, b].sort().join('-'));
    }
    expect(pairs.size).toBe(15);
  });

  it('gives an odd number of teams a bye each round, and still plays every pair once', () => {
    const rounds = roundRobin(ids(5));
    expect(rounds).toHaveLength(5);
    const pairs = new Set<string>();
    for (const round of rounds) {
      expect(round).toHaveLength(2);
      for (const [a, b] of round) pairs.add([a, b].sort().join('-'));
    }
    expect(pairs.size).toBe(10);
  });

  it('keeps home and away within one of each other for every team', () => {
    for (const n of [3, 4, 5, 6, 7, 8]) {
      const home = new Map<string, number>();
      const away = new Map<string, number>();
      for (const round of roundRobin(ids(n))) {
        for (const [h, a] of round) {
          home.set(h, (home.get(h) ?? 0) + 1);
          away.set(a, (away.get(a) ?? 0) + 1);
        }
      }
      for (const id of ids(n)) expect(Math.abs((home.get(id) ?? 0) - (away.get(id) ?? 0))).toBeLessThanOrEqual(1);
    }
  });

  it('handles tiny leagues', () => {
    expect(roundRobin([])).toEqual([]);
    expect(roundRobin(['a'])).toEqual([]);
    expect(roundRobin(['a', 'b'])).toHaveLength(1);
  });
});

describe('planSeason', () => {
  it('plans a single round-robin: every pair once, one match per team per date, on the host club pitch', () => {
    const input = league(4);
    const result = planSeason(input);
    expect(result.unplanned).toEqual([]);
    expect(result.matches).toHaveLength(6);

    const pairs = new Set(result.matches.map((m) => [m.homeTeamId, m.awayTeamId].sort().join('|')));
    expect(pairs.size).toBe(6);

    const seen = new Set<string>();
    for (const m of result.matches) {
      for (const team of [m.homeTeamId, m.awayTeamId]) {
        const key = `${m.date}|${team}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
      const hostClub = input.teams.find((t) => t.id === m.homeTeamId)!.clubId;
      expect(m.pitchId).toBe(`p${hostClub.slice(1)}`);
      expect(SATURDAYS).toContain(m.date);
    }
  });

  it('only plans inside the published openings, in UK time, on 5-minute marks', () => {
    const result = planSeason(league(4));
    for (const m of result.matches) {
      // Matches start at 09:00 local: 08:00Z in British Summer Time, 09:00Z after the clocks go back on 25 October.
      const expected = m.date < '2026-10-25' ? '08:00' : '09:00';
      expect(m.startsAt.slice(11, 16)).toBe(expected);
    }
  });

  it('plans a double round-robin: every pair twice, once each way', () => {
    const result = planSeason(league(4, undefined, { doubleRound: true }));
    expect(result.unplanned).toEqual([]);
    expect(result.matches).toHaveLength(12);
    const direction = new Map<string, number>();
    for (const m of result.matches) direction.set(`${m.homeTeamId}>${m.awayTeamId}`, (direction.get(`${m.homeTeamId}>${m.awayTeamId}`) ?? 0) + 1);
    // 12 different directed pairings, none repeated
    expect(direction.size).toBe(12);
    for (const s of result.stats) expect(s.home).toBe(s.away);
  });

  it('never double-books a pitch, including the turnaround, when several divisions share it', () => {
    const divisions = [
      { name: 'U12 Boys', ageGroup: 'U12' as const },
      { name: 'U10 Girls', ageGroup: 'U10' as const },
    ];
    const input = league(4, divisions, { doubleRound: true, dates: SATURDAYS });
    const result = planSeason(input);
    const byPitch = new Map<string, { from: number; to: number }[]>();
    for (const m of result.matches) {
      const from = Date.parse(m.startsAt);
      const to = from + (m.durationMinutes + 10) * 60_000;
      for (const other of byPitch.get(m.pitchId) ?? []) expect(from < other.to && other.from < to).toBe(false);
      byPitch.set(m.pitchId, [...(byPitch.get(m.pitchId) ?? []), { from, to }]);
    }
    expect(result.matches.length + result.unplanned.length).toBe(24);
  });

  it('swaps the host when the home club has no room that day', () => {
    // Club 1's only opening is too short for a match; club 2's is fine. So club 2 must host every match between them.
    const input = league(2);
    input.clubs[0]!.pitches = [pitch('p1', 'c1', [{ start: 540, end: 570, groups: ['U12'] }])];
    const result = planSeason({ ...input, doubleRound: true });
    expect(result.matches).toHaveLength(2);
    expect(result.matches.every((m) => m.pitchId === 'p2' && m.homeTeamId === 'c2-U12 Boys')).toBe(true);
  });

  it('puts two matches at one club on the same day one after the other, never at once', () => {
    // 4 teams; give club 1 two back-to-back slots' worth of time and the others none: club 1 hosts everything.
    const input = league(4);
    input.clubs = input.clubs.map((c, i) => (i === 0 ? c : { ...c, pitches: [] }));
    input.clubs[0]!.pitches = [pitch('p1', 'c1', [{ start: 540, end: 780, groups: ['U12'] }])];
    const result = planSeason(input);
    // Only matches involving club 1 can be hosted (by club 1); the other three clubs have no pitch at all.
    expect(result.matches.length).toBeGreaterThan(0);
    for (const m of result.matches) expect(m.pitchId).toBe('p1');
    const starts = result.matches.filter((m) => m.date === result.matches[0]!.date).map((m) => m.startsAt);
    expect(new Set(starts).size).toBe(starts.length);
  });

  it('reports matches it cannot place, with the reason, instead of hiding them', () => {
    const input = league(4, undefined, { doubleRound: true, dates: SATURDAYS.slice(0, 4) });
    const result = planSeason(input);
    // Four dates hold four rounds of two matches; the last two rounds (four matches) have no date left.
    expect(result.matches).toHaveLength(8);
    expect(result.unplanned).toHaveLength(4);
    expect(result.unplanned[0]!.reason).toMatch(/not enough dates/);

    const noPitches = league(3);
    noPitches.clubs = noPitches.clubs.map((c) => ({ ...c, pitches: [] }));
    const none = planSeason(noPitches);
    expect(none.matches).toHaveLength(0);
    expect(none.unplanned).toHaveLength(3);
    expect(none.unplanned[0]!.reason).toMatch(/No pitch time/);
  });

  it('avoids pitch time that is already booked', () => {
    const input = league(2);
    const nineAm = instantAt('2026-10-03', 540, TZ);
    const blocked = planSeason({ ...input, dates: ['2026-10-03'], booked: [{ pitchId: 'p1', startsAt: nineAm, durationMinutes: 50 }, { pitchId: 'p2', startsAt: nineAm, durationMinutes: 50 }] });
    expect(blocked.matches).toHaveLength(1);
    // 09:00 is taken for 50 minutes + 10 turnaround, so the match starts at 10:00
    expect(blocked.matches[0]!.startsAt).toBe(instantAt('2026-10-03', 600, TZ));
  });

  it('counts home, away and away miles for each team', () => {
    const miles: Record<string, number> = { 'c1|c2': 10, 'c1|c3': 25, 'c2|c3': 5 };
    const distance = (a: string, b: string) => miles[[a, b].sort().join('|')] ?? 0;
    const result = planSeason(league(3, undefined, { distance, doubleRound: true }));
    expect(result.unplanned).toEqual([]);
    for (const s of result.stats) {
      expect(s.played).toBe(4);
      expect(s.home + s.away).toBe(4);
    }
    // Everyone travels to each of the other two clubs once, in a double round-robin
    const total = (id: string) => result.stats.find((s) => s.teamId === id)!.awayMiles;
    expect(total('c1-U12 Boys')).toBe(35);
    expect(total('c2-U12 Boys')).toBe(15);
    expect(total('c3-U12 Boys')).toBe(30);
  });

  it('is repeatable for a given seed, and more attempts never make the plan worse', () => {
    const base = league(6, undefined, { doubleRound: true });
    const a = planSeason({ ...base, seed: 7 });
    const b = planSeason({ ...base, seed: 7 });
    expect(b).toEqual(a);
    const one = planSeason({ ...base, attempts: 1 });
    const many = planSeason({ ...base, attempts: 80 });
    expect(many.score).toBeLessThanOrEqual(one.score);
  });

  it('keeps home and away even when there is room for it', () => {
    const result = planSeason(league(6, undefined, { doubleRound: true, dates: SATURDAYS.concat(['2026-11-28', '2026-12-05', '2026-12-12', '2026-12-19']) }));
    expect(result.unplanned).toEqual([]);
    for (const s of result.stats) expect(Math.abs(s.home - s.away)).toBeLessThanOrEqual(1);
  });
});
