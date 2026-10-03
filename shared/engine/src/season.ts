import type { AgeGroup, Id, Pitch } from '@hockey/contracts';
import { instantAt, localParts, TURNAROUND_MINUTES } from './schedule';

/** A club in the league, with the pitches it can host matches on. */
export interface SeasonClub {
  id: Id;
  name: string;
  pitches: Pitch[];
}

/** A team in one division (e.g. "U12 Boys"). Teams only play others in the same division. */
export interface SeasonTeam {
  id: Id;
  clubId: Id;
  name: string;
  division: string;
  /** Decides which pitch openings the team can use. */
  ageGroup: AgeGroup;
}

/** A pitch already taken at some time (a match from outside this plan), so the plan avoids it. */
export interface BookedPitch {
  pitchId: Id;
  startsAt: string;
  durationMinutes: number;
}

export interface SeasonInput {
  clubs: SeasonClub[];
  teams: SeasonTeam[];
  /** Local dates (YYYY-MM-DD) matches can be played on, in order, such as every Saturday of the season. */
  dates: string[];
  /** How long a match is for this age group, in minutes. */
  durationMinutes: (ageGroup: AgeGroup) => number;
  /** Everyone plays everyone twice (home and away) instead of once. */
  doubleRound: boolean;
  timeZone: string;
  /** Miles between two clubs, used to balance travel. Defaults to the same distance for every pair. */
  distance?: (clubA: Id, clubB: Id) => number;
  turnaroundMinutes?: number;
  booked?: BookedPitch[];
  /** How many different orderings to try; the best one is kept. Default 60. */
  attempts?: number;
  /** Makes the search repeatable. Default 1. */
  seed?: number;
}

export interface PlannedMatch {
  homeTeamId: Id;
  awayTeamId: Id;
  division: string;
  ageGroup: AgeGroup;
  /** Local date. */
  date: string;
  startsAt: string;
  durationMinutes: number;
  /** The host club's pitch. */
  pitchId: Id;
  /** Round number within the division, starting at 1 (the second half of a double round continues the count). */
  round: number;
}

export interface UnplannedMatch {
  homeTeamId: Id;
  awayTeamId: Id;
  division: string;
  reason: string;
}

export interface TeamSeasonStats {
  teamId: Id;
  played: number;
  home: number;
  away: number;
  /** Total miles travelled to away matches. */
  awayMiles: number;
}

export interface SeasonResult {
  matches: PlannedMatch[];
  unplanned: UnplannedMatch[];
  stats: TeamSeasonStats[];
  /** Lower is better; 0 means every match is placed and home/away is even. */
  score: number;
}

/** A small repeatable random number generator (mulberry32), so the same seed always gives the same plan. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Round-robin pairings: in each round every team plays at most once (one sits out when there is an odd number),
 * and every pair meets exactly once. The rounds come from the circle method. Who is at home is decided
 * separately, by a fixed rule that makes every team's home and away games differ by at most one over the whole
 * round-robin (and exactly even in a double round-robin).
 */
export function roundRobin(teamIds: Id[]): [Id, Id][][] {
  if (teamIds.length < 2) return [];
  const indexOf = new Map(teamIds.map((id, i) => [id, i]));
  const n = teamIds.length;

  /** True when team `a` hosts team `b`. */
  const hosts = (a: Id, b: Id): boolean => {
    const i = indexOf.get(a)!;
    const j = indexOf.get(b)!;
    // With an even number of teams the last one is set aside: it hosts the odd-numbered teams and visits the even ones.
    const last = n % 2 === 0 ? n - 1 : -1;
    if (i === last) return j % 2 === 1;
    if (j === last) return i % 2 === 0;
    // Everyone else: a regular tournament, each team hosting the next half of the circle after it.
    const size = last === -1 ? n : n - 1;
    const ahead = (j - i + size) % size;
    return ahead >= 1 && ahead <= (size - 1) / 2;
  };

  const ids: (Id | null)[] = [...teamIds];
  if (ids.length % 2 === 1) ids.push(null); // a bye
  const m = ids.length;
  const rounds: [Id, Id][][] = [];
  const rotating = ids.slice(1);
  for (let r = 0; r < m - 1; r++) {
    const order: (Id | null)[] = [ids[0]!, ...rotating];
    const round: [Id, Id][] = [];
    for (let i = 0; i < m / 2; i++) {
      const a = order[i]!;
      const b = order[m - 1 - i]!;
      if (a === null || b === null) continue;
      round.push(hosts(a, b) ? [a, b] : [b, a]);
    }
    rounds.push(round);
    rotating.unshift(rotating.pop()!);
  }
  return rounds;
}

interface Interval {
  from: number;
  to: number;
}

const overlaps = (a: Interval, b: Interval) => a.from < b.to && b.from < a.to;

/** Plan one ordering of the teams. */
function planOnce(input: SeasonInput, order: Map<string, SeasonTeam[]>): SeasonResult {
  const turnaround = input.turnaroundMinutes ?? TURNAROUND_MINUTES;
  const distance = input.distance ?? (() => 1);
  const clubs = new Map(input.clubs.map((c) => [c.id, c]));
  const teamById = new Map(input.teams.map((t) => [t.id, t]));
  const STEP = 5;

  // Pitch time already used, per pitch, as instants in ms.
  const taken = new Map<Id, Interval[]>();
  for (const b of input.booked ?? []) {
    const from = Date.parse(b.startsAt);
    taken.set(b.pitchId, [...(taken.get(b.pitchId) ?? []), { from, to: from + (b.durationMinutes + turnaround) * 60_000 }]);
  }
  const playingOn = new Set<string>(); // `${date}|${teamId}`

  const matches: PlannedMatch[] = [];
  const unplanned: UnplannedMatch[] = [];
  const counts = new Map<Id, { home: number; away: number; miles: number }>(input.teams.map((t) => [t.id, { home: 0, away: 0, miles: 0 }]));

  /** The earliest pitch and start that fits this match at this club on this date, if any. */
  const findSlot = (clubId: Id, date: string, ageGroup: AgeGroup, minutes: number) => {
    const club = clubs.get(clubId);
    if (!club) return null;
    const weekday = localParts(instantAt(date, 12 * 60, input.timeZone), input.timeZone).weekday;
    let best: { pitchId: Id; startsAt: string; ms: number } | null = null;
    for (const pitch of club.pitches) {
      for (const slot of pitch.slots) {
        if (slot.weekday !== weekday || !slot.ageGroups.includes(ageGroup)) continue;
        for (let minute = slot.startMinute; minute + minutes <= slot.endMinute; minute += STEP) {
          const startsAt = instantAt(date, minute, input.timeZone);
          const from = Date.parse(startsAt);
          const mine: Interval = { from, to: from + (minutes + turnaround) * 60_000 };
          if ((taken.get(pitch.id) ?? []).some((t) => overlaps(mine, t))) continue;
          if (!best || from < best.ms) best = { pitchId: pitch.id, startsAt, ms: from };
          break; // later starts in this opening are only worse
        }
      }
    }
    return best;
  };

  const place = (match: { home: SeasonTeam; away: SeasonTeam; round: number }, date: string): boolean => {
    const minutes = input.durationMinutes(match.home.ageGroup);
    if (playingOn.has(`${date}|${match.home.id}`) || playingOn.has(`${date}|${match.away.id}`)) return false;
    // The home team's club hosts; if it has nothing free that day, the away team's club can host instead.
    for (const [host, guest] of [[match.home, match.away], [match.away, match.home]] as const) {
      const slot = findSlot(host.clubId, date, host.ageGroup, minutes);
      if (!slot) continue;
      taken.set(slot.pitchId, [...(taken.get(slot.pitchId) ?? []), { from: slot.ms, to: slot.ms + (minutes + turnaround) * 60_000 }]);
      playingOn.add(`${date}|${host.id}`);
      playingOn.add(`${date}|${guest.id}`);
      matches.push({ homeTeamId: host.id, awayTeamId: guest.id, division: host.division, ageGroup: host.ageGroup, date, startsAt: slot.startsAt, durationMinutes: minutes, pitchId: slot.pitchId, round: match.round });
      counts.get(host.id)!.home++;
      const away = counts.get(guest.id)!;
      away.away++;
      away.miles += distance(guest.clubId, host.clubId);
      return true;
    }
    return false;
  };

  // Build every division's rounds; round i is played on the i-th available date.
  const fixtures: { home: SeasonTeam; away: SeasonTeam; round: number }[] = [];
  for (const [, divisionTeams] of order) {
    const single = roundRobin(divisionTeams.map((t) => t.id));
    const all = input.doubleRound ? [...single, ...single.map((round) => round.map(([h, a]) => [a, h] as [Id, Id]))] : single;
    all.forEach((round, r) => {
      for (const [h, a] of round) fixtures.push({ home: teamById.get(h)!, away: teamById.get(a)!, round: r + 1 });
    });
  }

  const leftover: typeof fixtures = [];
  for (const f of fixtures.sort((a, b) => a.round - b.round)) {
    const date = input.dates[f.round - 1];
    if (date && place(f, date)) continue;
    leftover.push(f);
  }

  // Anything that did not fit its own date gets a second chance on any other date where both teams are free.
  for (const f of leftover) {
    const placed = input.dates.some((date) => place(f, date));
    if (!placed) {
      const noDate = f.round > input.dates.length;
      unplanned.push({
        homeTeamId: f.home.id,
        awayTeamId: f.away.id,
        division: f.home.division,
        reason: noDate
          ? `There are not enough dates: round ${f.round} has no date left.`
          : `No pitch time was free for ${f.home.ageGroup} at ${clubs.get(f.home.clubId)?.name ?? 'the home club'} or ${clubs.get(f.away.clubId)?.name ?? 'the away club'} on any date.`,
      });
    }
  }

  matches.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.division.localeCompare(b.division));
  const stats = input.teams.map((t) => {
    const c = counts.get(t.id)!;
    return { teamId: t.id, played: c.home + c.away, home: c.home, away: c.away, awayMiles: Math.round(c.miles * 10) / 10 };
  });
  const imbalance = stats.reduce((sum, s) => sum + Math.max(0, Math.abs(s.home - s.away) - 1), 0);
  const travel = stats.map((s) => s.awayMiles);
  const spread = travel.length ? Math.max(...travel) - Math.min(...travel) : 0;
  return { matches, unplanned, stats, score: unplanned.length * 10_000 + imbalance * 100 + spread };
}

/**
 * Plan a whole season: who plays whom, on which date, on which pitch, at what time. Teams meet others in their
 * division once or twice, never play twice on a date, only use pitch openings published for their age group,
 * never double-book a pitch, and home and away stay as even as the pitch times allow. It tries many team
 * orderings (repeatably, from a seed) and keeps the plan with the fewest unplaced matches, the fairest
 * home/away split and the most even travel.
 */
export function planSeason(input: SeasonInput): SeasonResult {
  const random = rng(input.seed ?? 1);
  const divisions = new Map<string, SeasonTeam[]>();
  for (const team of input.teams) divisions.set(team.division, [...(divisions.get(team.division) ?? []), team]);

  let best: SeasonResult | null = null;
  const attempts = Math.max(1, input.attempts ?? 60);
  for (let i = 0; i < attempts; i++) {
    const order = new Map<string, SeasonTeam[]>();
    for (const [name, teams] of divisions) order.set(name, i === 0 ? teams : shuffled(teams, random));
    const result = planOnce(input, order);
    if (!best || result.score < best.score) best = result;
    if (best.score === 0 && i >= 5) break; // nothing left to improve
  }
  return best!;
}
