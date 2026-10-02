import type {
  Availability,
  AvailabilityStatus,
  AuthSession,
  Fixture,
  Formation,
  FormationLayout,
  Id,
  Lineup,
  Me,
  NewCustomFormation,
  PlayerProfile,
  SquadFormat,
  SuggestionRequest,
  SuggestionResult,
} from '@hockey/contracts';

export type LineupDraft = Pick<Lineup, 'formationId' | 'strategy' | 'starting' | 'bench' | 'substitutions'>;

/**
 * Typed API client mirroring shared/contracts/api-spec.yaml. Screens only
 * talk to this interface; the mock and HTTP implementations are swappable.
 */
export interface ApiClient {
  readonly mode: 'mock' | 'http';

  requestSignIn(email: string): Promise<{ devLink?: string }>;
  verifySignIn(token: string): Promise<AuthSession>;
  signOut(): Promise<void>;
  me(): Promise<Me>;

  getSquad(teamId: Id): Promise<PlayerProfile[]>;
  getFixtures(teamId: Id, from?: string): Promise<Fixture[]>;
  getAvailability(fixtureId: Id): Promise<Availability[]>;
  setAvailability(fixtureId: Id, memberId: Id, status: AvailabilityStatus): Promise<Availability>;

  getFormations(format: SquadFormat): Promise<Formation[]>;
  getCustomFormations(teamId: Id, format?: SquadFormat): Promise<Formation[]>;
  createCustomFormation(teamId: Id, input: NewCustomFormation): Promise<Formation>;
  getFormationLayouts(teamId: Id): Promise<FormationLayout[]>;
  saveFormationLayout(teamId: Id, layout: FormationLayout): Promise<FormationLayout>;
  resetFormationLayout(teamId: Id, formationId: string): Promise<void>;
  suggest(request: SuggestionRequest): Promise<SuggestionResult>;
  getLineup(fixtureId: Id): Promise<Lineup | null>;
  saveLineup(fixtureId: Id, lineup: LineupDraft): Promise<Lineup>;
  shareLineup(fixtureId: Id, memberIds: Id[]): Promise<{ sharedWith: number }>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
