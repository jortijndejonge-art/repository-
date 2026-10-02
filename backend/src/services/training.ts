import type { Id, TrainingResponse, TrainingSession } from '@hockey/contracts';
import type { Repository } from '../db/repository';
import { notFound } from './errors';

export class TrainingService {
  constructor(private readonly repo: Repository) {}

  async session(id: Id): Promise<TrainingSession> {
    const session = await this.repo.getTrainingSession(id);
    if (!session) throw notFound('Training session not found');
    return session;
  }

  /** The whole squad's answers for a session; players who haven't answered show as no_response. */
  async responses(sessionId: Id): Promise<TrainingResponse[]> {
    const session = await this.session(sessionId);
    const [players, rows] = await Promise.all([
      this.repo.listTeamPlayers(session.teamId),
      this.repo.listTrainingResponses(sessionId),
    ]);
    const byMember = new Map(rows.map((r) => [r.memberId, r]));
    return players.map((p) => byMember.get(p.memberId) ?? { sessionId, memberId: p.memberId, rsvp: 'no_response' as const });
  }

  async requireInSquad(teamId: Id, memberId: Id) {
    const squad = await this.repo.listTeamPlayers(teamId);
    if (!squad.some((p) => p.memberId === memberId)) throw notFound('Player not in this team');
  }
}
