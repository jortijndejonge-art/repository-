import type { ApplyMatch, ApplyResult, Id } from '@hockey/contracts';
import type { Repository } from '../db/repository';
import { badRequest, notFound } from './errors';

/** The youngest play two halves; everyone else four quarters. */
const periodsFor = (ageGroup: string) => (ageGroup === 'U8' ? 2 : 4);

/** Turns a planned season into fixtures for the club's own teams, without ever creating the same match twice. */
export class LeagueService {
  constructor(private readonly repo: Repository) {}

  async league(id: Id) {
    const league = await this.repo.getLeague(id);
    if (!league) throw notFound('Season plan not found');
    return league;
  }

  async apply(leagueId: Id, matches: ApplyMatch[]): Promise<ApplyResult> {
    const league = await this.league(leagueId);
    const teams = new Map<Id, Awaited<ReturnType<Repository['getTeam']>>>();
    const pitchClub = new Map<Id, Id | null>();
    const result: ApplyResult = { created: 0, skipped: 0 };
    const existing = new Map<Id, Set<string>>();

    for (const m of matches) {
      if (!teams.has(m.teamId)) teams.set(m.teamId, await this.repo.getTeam(m.teamId));
      const team = teams.get(m.teamId);
      if (!team || team.clubId !== league.clubId) throw badRequest('One of those matches is for a team outside this club');

      let pitchId = m.pitchId;
      if (pitchId) {
        if (!pitchClub.has(pitchId)) pitchClub.set(pitchId, (await this.repo.getPitch(pitchId))?.clubId ?? null);
        if (pitchClub.get(pitchId) !== league.clubId) throw badRequest('One of those matches uses a pitch outside this club');
      }
      if (m.homeAway === 'away') pitchId = undefined;

      // Skip a match the team already has at that time, so applying a plan twice is harmless.
      if (!existing.has(m.teamId)) {
        existing.set(m.teamId, new Set((await this.repo.listTeamFixtures(m.teamId)).map((f) => new Date(f.startsAt).toISOString())));
      }
      const key = new Date(m.startsAt).toISOString();
      if (existing.get(m.teamId)!.has(key)) {
        result.skipped++;
        continue;
      }

      await this.repo.addFixture(m.teamId, {
        opponent: m.opponent,
        startsAt: m.startsAt,
        venue: m.venue,
        homeAway: m.homeAway,
        format: team.defaultFormat,
        durationMinutes: m.durationMinutes,
        periods: periodsFor(team.ageGroup),
        ...(pitchId ? { pitchId } : {}),
      });
      existing.get(m.teamId)!.add(key);
      result.created++;
    }
    return result;
  }
}
