import type { Id, Lineup, SuggestionRequest, SuggestionResult } from '@hockey/contracts';
import { FORMATIONS, getFormation, suggestLineup } from '@hockey/engine';
import type { Repository } from '../db/repository';
import { badRequest, conflict, notFound } from './errors';
import type { Mailer } from './mailer';

export class LineupService {
  constructor(
    private readonly repo: Repository,
    private readonly mailer: Mailer,
    private readonly appUrl: string,
  ) {}

  async fixture(fixtureId: Id) {
    const fixture = await this.repo.getFixture(fixtureId);
    if (!fixture) throw notFound('Fixture not found');
    return fixture;
  }

  /** The whole squad's availability for a fixture; players who haven't answered show as no_response. */
  async availability(fixtureId: Id) {
    const fixture = await this.fixture(fixtureId);
    const [players, rows] = await Promise.all([
      this.repo.listTeamPlayers(fixture.teamId),
      this.repo.listAvailability(fixtureId),
    ]);
    const byMember = new Map(rows.map((r) => [r.memberId, r]));
    return players.map(
      (p) =>
        byMember.get(p.memberId) ?? {
          fixtureId,
          memberId: p.memberId,
          status: 'no_response' as const,
          updatedAt: new Date(0).toISOString(),
        },
    );
  }

  async suggest(request: SuggestionRequest): Promise<SuggestionResult> {
    const fixture = await this.fixture(request.fixtureId);
    const formation = FORMATIONS.find((f) => f.id === request.formationId);
    if (!formation) throw badRequest(`Unknown formation ${request.formationId}`);
    const [players, availability] = await Promise.all([
      this.repo.listTeamPlayers(fixture.teamId),
      this.repo.listAvailability(fixture.id),
    ]);
    const available = new Set(availability.filter((a) => a.status === 'available').map((a) => a.memberId));
    return suggestLineup({
      players: players.filter((p) => available.has(p.memberId)),
      formation,
      strategy: request.strategy,
      durationMinutes: fixture.durationMinutes,
      periods: fixture.periods,
      locked: request.locked,
    });
  }

  async save(fixtureId: Id, lineup: Pick<Lineup, 'formationId' | 'strategy' | 'starting' | 'bench' | 'substitutions'>) {
    const fixture = await this.fixture(fixtureId);
    let formation;
    try {
      formation = getFormation(lineup.formationId);
    } catch {
      throw badRequest(`Unknown formation ${lineup.formationId}`);
    }
    const squad = new Set((await this.repo.listTeamPlayers(fixture.teamId)).map((p) => p.memberId));
    const slotIds = new Set(formation.slots.map((s) => s.id));
    for (const s of lineup.starting) {
      if (!slotIds.has(s.slotId)) throw badRequest(`Slot ${s.slotId} is not in formation ${formation.id}`);
      if (s.memberId && !squad.has(s.memberId)) throw badRequest(`${s.memberId} is not in this squad`);
    }
    const named = [...lineup.starting.map((s) => s.memberId).filter(Boolean), ...lineup.bench] as Id[];
    if (new Set(named).size !== named.length) throw badRequest('A player appears more than once');
    for (const id of lineup.bench) if (!squad.has(id)) throw badRequest(`${id} is not in this squad`);
    for (const sub of lineup.substitutions) {
      if (!slotIds.has(sub.slotId)) throw badRequest(`Substitution slot ${sub.slotId} is not in the formation`);
      if (!squad.has(sub.onMemberId) || !squad.has(sub.offMemberId)) throw badRequest('Substitution player not in squad');
    }
    return this.repo.saveLineup({ fixtureId, ...lineup });
  }

  /** Notify chosen players (default: everyone in the saved lineup) and record who was told. */
  async share(fixtureId: Id, memberIds?: Id[]) {
    const fixture = await this.fixture(fixtureId);
    const lineup = await this.repo.getLineup(fixtureId);
    if (!lineup) throw conflict('Save the lineup before sharing it');
    const squad = await this.repo.listTeamPlayers(fixture.teamId);
    const squadIds = new Set(squad.map((p) => p.memberId));
    const recipients =
      memberIds ?? [...lineup.starting.map((s) => s.memberId).filter(Boolean), ...lineup.bench];
    for (const id of recipients) if (!squadIds.has(id as Id)) throw badRequest(`${id} is not in this squad`);

    const team = await this.repo.getTeam(fixture.teamId);
    const kickoff = new Date(fixture.startsAt).toUTCString().replace(':00 GMT', ' GMT');
    for (const id of recipients as Id[]) {
      const member = await this.repo.getMember(id);
      if (!member?.email) continue;
      const slot = lineup.starting.find((s) => s.memberId === id);
      const role = slot ? `You're starting at ${slot.slotId}.` : lineup.bench.includes(id) ? "You're on the bench." : '';
      await this.mailer.send({
        to: member.email,
        subject: `Lineup: ${team?.name} vs ${fixture.opponent}`,
        text: [`The lineup for ${team?.name} vs ${fixture.opponent} (${kickoff}) is out.`, role, '', this.appUrl]
          .filter((l) => l !== undefined)
          .join('\n'),
      });
    }
    await this.repo.recordShare(fixtureId, recipients as Id[]);
    return { sharedWith: recipients.length };
  }
}
