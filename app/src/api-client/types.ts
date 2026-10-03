import type {
  ChatMessage,
  ChatThread,
  ChatUnread,
  ChaseResult,
  ClubFixture,
  NewPitchSlot,
  Pitch,
  PitchSlot,
  ScheduleConflict,
  EventKind,
  ImportRequest,
  ImportResult,
  PlayerStats,
  Briefing,
  BriefingRead,
  NewBriefing,
  LiveMatch,
  GuardianSummary,
  NewGuardian,
  Announcement,
  NewAnnouncement,
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
  NewTrainingSession,
  NewPlayer,
  PlayerProfile,
  PlayerProfileUpdate,
  SquadFormat,
  SuggestionRequest,
  TrainingResponse,
  TrainingSession,
  TrainingSessionUpdate,
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
  /** A clashing time is refused with a 409 (see `clashesOf`) unless `force` is set. */
  addFixture(teamId: Id, fixture: NewFixture, opts?: { force?: boolean }): Promise<Fixture>;
  updateFixture(fixtureId: Id, update: FixtureUpdate, opts?: { force?: boolean }): Promise<Fixture>;
  /** What would clash if a match were saved like this (`id` = the match being edited). */
  checkFixtureConflicts(teamId: Id, candidate: { id?: Id; startsAt: string; durationMinutes: number; pitchId?: Id }): Promise<ScheduleConflict[]>;
  getPitches(clubId: Id): Promise<Pitch[]>;
  addPitch(clubId: Id, name: string): Promise<Pitch>;
  deletePitch(pitchId: Id): Promise<void>;
  addPitchSlot(pitchId: Id, slot: NewPitchSlot): Promise<PitchSlot>;
  deletePitchSlot(slotId: Id): Promise<void>;
  /** Manager: every team's matches in a stretch of time. */
  getClubSchedule(clubId: Id, from: string, to: string): Promise<ClubFixture[]>;
  deleteFixture(fixtureId: Id): Promise<void>;
  /** Manager: remind everyone who has not said whether they can play (posted in the match chat). */
  chaseAvailability(fixtureId: Id): Promise<ChaseResult>;
  /** Manager: bulk-add players from a spreadsheet. Bad rows are skipped with a reason, not fatal. */
  importPlayers(teamId: Id, request: ImportRequest): Promise<ImportResult>;
  /** Manager: attendance, availability and minutes for each player in a team. */
  getTeamStats(teamId: Id): Promise<PlayerStats[]>;
  /** The pre-match briefing, or null. `memberId` asks on behalf of a child. */
  getBriefing(fixtureId: Id, memberId?: Id): Promise<Briefing | null>;
  saveBriefing(fixtureId: Id, briefing: NewBriefing): Promise<Briefing>;
  deleteBriefing(fixtureId: Id): Promise<void>;
  /** Manager: who in the squad has read the current version. */
  getBriefingReads(fixtureId: Id): Promise<BriefingRead[]>;
  markBriefingSeen(fixtureId: Id, memberId?: Id): Promise<void>;
  /** The live clock and substitutions for a match; null until it has been started. */
  getLiveMatch(fixtureId: Id): Promise<LiveMatch | null>;
  liveAction(fixtureId: Id, action: 'start' | 'pause' | 'resume' | 'finish'): Promise<LiveMatch>;
  liveSubstitute(fixtureId: Id, slotId: string, offMemberId: Id, onMemberId: Id): Promise<LiveMatch>;
  getGuardians(teamId: Id, childId: Id): Promise<GuardianSummary[]>;
  /** Links a parent to a player; a brand-new parent also comes back with a first password, shown once. */
  addGuardian(teamId: Id, childId: Id, guardian: NewGuardian): Promise<{ guardian: GuardianSummary; password?: string }>;
  getAnnouncements(teamId: Id): Promise<Announcement[]>;
  postAnnouncement(teamId: Id, announcement: NewAnnouncement): Promise<Announcement>;
  deleteAnnouncement(announcementId: Id): Promise<void>;
  getTrainingSessions(teamId: Id, from?: string): Promise<TrainingSession[]>;
  addTrainingSession(teamId: Id, session: NewTrainingSession): Promise<TrainingSession>;
  updateTrainingSession(sessionId: Id, update: TrainingSessionUpdate): Promise<TrainingSession>;
  deleteTrainingSession(sessionId: Id): Promise<void>;
  getTrainingResponses(sessionId: Id): Promise<TrainingResponse[]>;
  setTrainingRsvp(sessionId: Id, memberId: Id, status: AvailabilityStatus): Promise<void>;
  setTrainingAttendance(sessionId: Id, memberId: Id, attended: boolean): Promise<void>;
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

  // Event chat: a group chat on each match and training session
  getEventChat(kind: EventKind, eventId: Id): Promise<ChatThread>;
  postEventMessage(kind: EventKind, eventId: Id, body: string): Promise<ChatMessage>;
  /** Manager: post the saved lineup into the match chat as a card. */
  postLineupToChat(fixtureId: Id, note?: string): Promise<ChatMessage>;
  deleteChatMessage(messageId: Id): Promise<void>;
  getChatUnread(teamId: Id): Promise<ChatUnread[]>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Extra detail from the server, e.g. the clashes behind a 409. */
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** The clashes a 409 from saving a match carries, if it carries any. */
export function clashesOf(err: unknown): ScheduleConflict[] | null {
  const details = err instanceof ApiError ? (err.details as { conflicts?: ScheduleConflict[] } | undefined) : undefined;
  return details?.conflicts ?? null;
}
