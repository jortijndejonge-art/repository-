import type {
  Availability,
  AvailabilityStatus,
  Club,
  Fixture,
  Formation,
  Id,
  Lineup,
  PlayerProfile,
  SquadFormat,
  SuggestionRequest,
  SuggestionResult,
  Team,
} from '@hockey/contracts';
import { formationsFor, getFormation, suggestLineup } from '@hockey/engine';
import * as seed from './seed';

/**
 * Typed API client mirroring shared/contracts/api-spec.yaml.
 * Screens only ever talk to this interface, so swapping the mock for the
 * real HTTP client later is a one-line change.
 */
export interface ApiClient {
  getClub(): Promise<Club>;
  getTeams(): Promise<Team[]>;
  getSquad(teamId: Id): Promise<PlayerProfile[]>;
  getNextFixture(teamId: Id): Promise<Fixture>;
  getAvailability(fixtureId: Id): Promise<Availability[]>;
  setAvailability(fixtureId: Id, memberId: Id, status: AvailabilityStatus): Promise<Availability>;
  getFormations(format: SquadFormat): Promise<Formation[]>;
  suggest(request: SuggestionRequest): Promise<SuggestionResult>;
  saveLineup(lineup: Lineup): Promise<Lineup>;
  shareLineup(fixtureId: Id, memberIds: Id[]): Promise<void>;
}

function createMockClient(): ApiClient {
  const availability = seed.seedAvailability();
  const lineups = new Map<Id, Lineup>();

  const fixture = (id: Id) => {
    const f = seed.fixtures.find((x) => x.id === id);
    if (!f) throw new Error(`Unknown fixture ${id}`);
    return f;
  };

  return {
    async getClub() {
      return seed.club;
    },
    async getTeams() {
      return seed.teams;
    },
    async getSquad(teamId) {
      return seed.squads[teamId] ?? [];
    },
    async getNextFixture(teamId) {
      const f = seed.fixtures.find((x) => x.teamId === teamId);
      if (!f) throw new Error(`No fixture for team ${teamId}`);
      return f;
    },
    async getAvailability(fixtureId) {
      return availability.filter((a) => a.fixtureId === fixtureId).map((a) => ({ ...a }));
    },
    async setAvailability(fixtureId, memberId, status) {
      const existing = availability.find((a) => a.fixtureId === fixtureId && a.memberId === memberId);
      const updated: Availability = { fixtureId, memberId, status, updatedAt: new Date().toISOString() };
      if (existing) Object.assign(existing, updated);
      else availability.push(updated);
      return updated;
    },
    async getFormations(format) {
      return formationsFor(format);
    },
    async suggest(request) {
      const f = fixture(request.fixtureId);
      const available = new Set(
        availability
          .filter((a) => a.fixtureId === f.id && a.status === 'available')
          .map((a) => a.memberId),
      );
      const players = (seed.squads[f.teamId] ?? []).filter((p) => available.has(p.memberId));
      return suggestLineup({
        players,
        formation: getFormation(request.formationId),
        strategy: request.strategy,
        durationMinutes: f.durationMinutes,
        periods: f.periods,
        locked: request.locked,
      });
    },
    async saveLineup(lineup) {
      const saved = { ...lineup, updatedAt: new Date().toISOString() };
      lineups.set(lineup.fixtureId, saved);
      return saved;
    },
    async shareLineup(fixtureId, memberIds) {
      const existing = lineups.get(fixtureId);
      if (existing) existing.sharedAt = new Date().toISOString();
      console.info(`[mock] lineup for ${fixtureId} shared with ${memberIds.length} players`);
    },
  };
}

export const api: ApiClient = createMockClient();
