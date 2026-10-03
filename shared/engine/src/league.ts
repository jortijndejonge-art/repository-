import type { AgeGroup, ApplyMatch, Id, LeagueConfig, Pitch } from '@hockey/contracts';
import { clock, instantAt, localParts } from './schedule';
import type { PlannedMatch, SeasonInput, SeasonResult, SeasonTeam } from './season';

/** Our club's side of a league: its id, its real pitches and the teams that can be entered. */
export interface OurClub {
  clubId: Id;
  clubName: string;
  pitches: Pitch[];
  teams: { id: Id; name: string; ageGroup: AgeGroup }[];
}

const OURS = 'ours';

/** The usual match length for an age group, when a division does not say. */
export function usualMinutes(ageGroup: AgeGroup): number {
  switch (ageGroup) {
    case 'U8':
      return 30;
    case 'U10':
    case 'U12':
      return 40;
    case 'U14':
      return 50;
    default:
      return 60;
  }
}

/** Monday = 0 … Sunday = 6, for a plain YYYY-MM-DD date. */
function weekdayOf(date: string): number {
  return (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
}

/** Every date from first to last, inclusive, that falls on the league's weekday and is not excluded. */
export function seasonDates(config: Pick<LeagueConfig, 'firstDate' | 'lastDate' | 'weekday' | 'excludedDates'>): string[] {
  const dates: string[] = [];
  const excluded = new Set(config.excludedDates);
  const end = Date.parse(`${config.lastDate}T12:00:00Z`);
  for (let t = Date.parse(`${config.firstDate}T12:00:00Z`); t <= end && dates.length < 120; t += 86_400_000) {
    const date = new Date(t).toISOString().slice(0, 10);
    if (weekdayOf(date) === config.weekday && !excluded.has(date)) dates.push(date);
  }
  return dates;
}

export interface LeaguePlanInput {
  input: SeasonInput;
  /** A readable name for every team and club id in the plan. */
  names: { teams: Map<string, string>; clubs: Map<string, string> };
}

/** Turn a league set-up into what the season planner needs. */
export function leagueToSeasonInput(config: LeagueConfig, ours: OurClub, timeZone: string, extra: Partial<SeasonInput> = {}): LeaguePlanInput {
  const clubs: SeasonInput['clubs'] = [{ id: OURS, name: ours.clubName, pitches: ours.pitches }];
  const teams: SeasonTeam[] = [];
  const teamNames = new Map<string, string>();
  const clubNames = new Map<string, string>([[OURS, ours.clubName]]);
  const miles = new Map<string, number>([[OURS, 0]]);

  for (const opp of config.opponents) {
    const pitchId = `opp:${opp.id}`;
    clubs.push({
      id: opp.id,
      name: opp.name,
      pitches: [{ id: pitchId, clubId: opp.id, name: opp.name, slots: opp.slots.map((s, i) => ({ id: `${pitchId}:${i}`, pitchId, ...s })) }],
    });
    clubNames.set(opp.id, opp.name);
    miles.set(opp.id, opp.miles);
  }

  for (const division of config.divisions) {
    const ourTeam = division.ourTeamId ? ours.teams.find((t) => t.id === division.ourTeamId) : undefined;
    if (ourTeam) {
      teams.push({ id: ourTeam.id, clubId: OURS, name: ourTeam.name, division: division.name, ageGroup: division.ageGroup });
      teamNames.set(ourTeam.id, ourTeam.name);
    }
    for (const opp of config.opponents.filter((o) => o.divisions.includes(division.name))) {
      const id = `${opp.id}:${division.name}`;
      teams.push({ id, clubId: opp.id, name: `${opp.name} ${division.name}`, division: division.name, ageGroup: division.ageGroup });
      teamNames.set(id, `${opp.name} ${division.name}`);
    }
  }

  const minutes = new Map<AgeGroup, number>();
  for (const d of config.divisions) if (d.durationMinutes && !minutes.has(d.ageGroup)) minutes.set(d.ageGroup, d.durationMinutes);

  return {
    input: {
      clubs,
      teams,
      dates: seasonDates(config),
      durationMinutes: (ageGroup) => minutes.get(ageGroup) ?? usualMinutes(ageGroup),
      doubleRound: config.doubleRound,
      timeZone,
      // Only our distance to each club is known; between two other clubs it is estimated from those.
      distance: (a, b) => (a === OURS || b === OURS ? Math.max(miles.get(a) ?? 0, miles.get(b) ?? 0) : Math.max(1, Math.abs((miles.get(a) ?? 0) - (miles.get(b) ?? 0)))),
      ...extra,
    },
    names: { teams: teamNames, clubs: clubNames },
  };
}

/** The matches of the plan that involve our own teams, as fixtures ready to be created. */
export function ourMatches(result: SeasonResult, plan: LeaguePlanInput, ours: OurClub): ApplyMatch[] {
  const ourIds = new Set(ours.teams.map((t) => t.id));
  const teamClub = new Map(plan.input.teams.map((t) => [t.id, t.clubId]));
  const pitchName = (pitchId: string) => ours.pitches.find((p) => p.id === pitchId)?.name;
  const out: ApplyMatch[] = [];
  for (const m of result.matches) {
    const home = ourIds.has(m.homeTeamId);
    const away = ourIds.has(m.awayTeamId);
    if (!home && !away) continue;
    const hostClub = plan.names.clubs.get(teamClub.get(m.homeTeamId) ?? '') ?? 'Home club';
    if (home) {
      out.push({
        teamId: m.homeTeamId,
        opponent: plan.names.teams.get(m.awayTeamId) ?? 'Opponent',
        homeAway: 'home',
        startsAt: m.startsAt,
        durationMinutes: m.durationMinutes,
        pitchId: m.pitchId,
        venue: pitchName(m.pitchId) ?? ours.clubName,
      });
    } else {
      out.push({
        teamId: m.awayTeamId,
        opponent: plan.names.teams.get(m.homeTeamId) ?? 'Opponent',
        homeAway: 'away',
        startsAt: m.startsAt,
        durationMinutes: m.durationMinutes,
        venue: hostClub,
      });
    }
  }
  return out;
}

/** "Sat 3 Oct, 09:00" for a planned match, in the given time zone. */
export function describeStart(m: Pick<PlannedMatch, 'startsAt'>, timeZone: string): string {
  const p = localParts(m.startsAt, timeZone);
  const d = new Date(`${p.date}T12:00:00Z`);
  return `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}, ${clock(p.minute)}`;
}


