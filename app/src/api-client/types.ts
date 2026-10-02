import type {
  Availability,
  AvailabilityStatus,
  AuthSession,
  CheckoutSession,
  Fixture,
  FixtureUpdate,
  Formation,
  FormationLayout,
  Id,
  Lineup,
  Me,
  MembershipPlan,
  MembershipRecord,
  NewMembershipPlan,
  PaymentsConfig,
  NewCustomFormation,
  NewFixture,
  NewPlayer,
  PlayerProfile,
  PlayerProfileUpdate,
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
  signInWithPassword(email: string, password: string): Promise<AuthSession>;
  changePassword(newPassword: string, currentPassword?: string): Promise<void>;
  signOut(): Promise<void>;
  me(): Promise<Me>;

  getSquad(teamId: Id): Promise<PlayerProfile[]>;
  addPlayer(teamId: Id, player: NewPlayer): Promise<PlayerProfile>;
  /** Manager hands a player a sign-in: returns the email and a new password, shown once. */
  createPlayerLogin(teamId: Id, memberId: Id, email?: string): Promise<{ email: string; password: string }>;
  updatePlayer(teamId: Id, memberId: Id, update: PlayerProfileUpdate): Promise<PlayerProfile>;
  getPaymentsConfig(): Promise<PaymentsConfig>;
  getMembershipPlans(clubId: Id): Promise<MembershipPlan[]>;
  createMembershipPlan(clubId: Id, plan: NewMembershipPlan): Promise<MembershipPlan>;
  getMyMemberships(): Promise<MembershipRecord[]>;
  /** Real mode returns a Stripe page to send the member to; demo mode simulates the payment. */
  startCheckout(planId: Id): Promise<CheckoutSession>;
  getFixtures(teamId: Id, from?: string): Promise<Fixture[]>;
  addFixture(teamId: Id, fixture: NewFixture): Promise<Fixture>;
  updateFixture(fixtureId: Id, update: FixtureUpdate): Promise<Fixture>;
  deleteFixture(fixtureId: Id): Promise<void>;
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
