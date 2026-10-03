import type { Id, ScheduleConflict } from '@hockey/contracts';
import { findConflicts } from '@hockey/engine';
import type { Repository } from '../db/repository';
import { badRequest, notFound } from './errors';

const DAY = 86_400_000;

export interface Candidate {
  /** Set when editing a match, so it is not compared with itself. */
  id?: Id;
  startsAt: string;
  durationMinutes: number;
  pitchId?: Id | null;
}

/** Checks a proposed match time against the club's pitches, other matches and the team's training. */
export class ScheduleService {
  constructor(private readonly repo: Repository) {}

  async conflictsFor(teamId: Id, candidate: Candidate): Promise<ScheduleConflict[]> {
    const team = await this.repo.getTeam(teamId);
    if (!team) throw notFound('Team not found');
    const pitchId = candidate.pitchId || undefined;
    if (pitchId) {
      const pitch = await this.repo.getPitch(pitchId);
      if (!pitch || pitch.clubId !== team.clubId) throw badRequest('That pitch belongs to another club');
    }

    // Only matches within a day either side can overlap, so that is all we load.
    const start = new Date(candidate.startsAt);
    const from = new Date(start.getTime() - DAY);
    const to = new Date(start.getTime() + 2 * DAY);
    const [pitches, fixtures, trainings, timeZone] = await Promise.all([
      this.repo.listPitches(team.clubId),
      this.repo.listClubFixtures(team.clubId, from, to),
      this.repo.listTrainingSessions(teamId, from.toISOString()),
      this.repo.getClubTimezone(team.clubId),
    ]);
    return findConflicts({
      candidate: {
        id: candidate.id ?? '__new__',
        teamId,
        ageGroup: team.ageGroup,
        startsAt: candidate.startsAt,
        durationMinutes: candidate.durationMinutes,
        ...(pitchId ? { pitchId } : {}),
      },
      fixtures,
      trainings: trainings.filter((t) => t.startsAt < to.toISOString()),
      pitches,
      timeZone,
    });
  }
}
