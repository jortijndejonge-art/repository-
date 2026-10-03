/**
 * Shared contract — the single source of truth for every layer
 * (backend, web app, and later the iOS/Android apps).
 *
 * FROZEN: change this file deliberately and in one place only.
 * Keep it in sync with api-spec.yaml.
 */

// ---------------------------------------------------------------------------
// Identity & tenancy: club -> team -> member
// ---------------------------------------------------------------------------

export type Id = string;
export type IsoDateTime = string;

export type Role = 'admin' | 'manager' | 'player' | 'guardian';

export interface Club {
  id: Id;
  name: string;
}

export type AgeGroup = 'U8' | 'U10' | 'U12' | 'U14' | 'U16' | 'U18' | 'Adult';

export interface Team {
  id: Id;
  clubId: Id;
  name: string;
  ageGroup: AgeGroup;
  /** Default squad format for this age group; switchable per match. */
  defaultFormat: SquadFormat;
}

export interface Member {
  id: Id;
  clubId: Id;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
}

export interface TeamMembership {
  teamId: Id;
  memberId: Id;
  roles: Role[];
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

/** Broad positional lines, matching the zone bands on the pitch. */
export type PositionLine = 'GK' | 'DEF' | 'MID' | 'FWD';

export interface PlayerProfile {
  memberId: Id;
  /** Name shown on the lineup token. */
  displayName: string;
  shirtNumber?: number;
  /** Lines this player can play, most-preferred first. */
  positions: PositionLine[];
  /** Overall skill/strength rating, 1 (developing) – 10 (strongest). */
  skill: number;
  /** Stamina rating, 1 (short stints) – 10 (can play the whole match). */
  stamina: number;
  /** Minutes on pitch so far this season (feeds fair-playing-time). */
  seasonMinutes: number;
}

/** Adding a new player to a squad (creates the member, team membership and profile). */
export interface NewPlayer {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  /** Defaults to "First L." */
  displayName?: string;
  shirtNumber?: number;
  positions: PositionLine[];
  skill: number;
  stamina: number;
}

export type PlayerProfileUpdate = Partial<Omit<PlayerProfile, 'memberId'>>;

/** The signed-in member with everything the app needs to start. */
/** A child a guardian looks after, with the teams they play for. */
export interface ChildSummary {
  memberId: Id;
  displayName: string;
  teams: Team[];
}

export interface Me {
  member: Member;
  club: Club;
  memberships: TeamMembership[];
  teams: Team[];
  /** Children this member is a guardian of (empty for most people). */
  children: ChildSummary[];
}

/** A parent or guardian as a manager sees them next to a player. */
export interface GuardianSummary {
  memberId: Id;
  firstName: string;
  lastName: string;
  email?: string;
}

/** Linking a parent to a player; the parent is created from these details if they are new to the club. */
export interface NewGuardian {
  firstName: string;
  lastName: string;
  email: string;
}

export interface AuthSession {
  accessToken: string;
  me: Me;
}

// ---------------------------------------------------------------------------
// Fixtures & availability
// ---------------------------------------------------------------------------

export interface Fixture {
  id: Id;
  teamId: Id;
  opponent: string;
  startsAt: IsoDateTime;
  venue: string;
  homeAway: 'home' | 'away';
  format: SquadFormat;
  /** Total playing time in minutes (e.g. 60 for 4 × 15). */
  durationMinutes: number;
  /** Number of periods (quarters/halves); substitution windows align to these. */
  periods: number;
}

// ---------------------------------------------------------------------------
// Availability chasing
// ---------------------------------------------------------------------------

/** Who was reminded to say whether they can play. */
export interface ChaseResult {
  reminded: number;
  names: string[];
}

// ---------------------------------------------------------------------------
// Bulk import (CSV from Spond, Teamo, spreadsheets)
// ---------------------------------------------------------------------------

/** One person from a spreadsheet, tidied and ready to become a player. */
export interface ImportRow {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  shirtNumber?: number;
  positions?: PositionLine[];
  /** A parent or guardian to link to this player. */
  guardianEmail?: string;
  guardianFirstName?: string;
  guardianLastName?: string;
}

export interface ImportRequest {
  players: ImportRow[];
  /** Also create a sign-in password for each player who has an email. */
  createLogins: boolean;
}

/** A sign-in created during an import, shown once so the manager can hand it out. */
export interface ImportLogin {
  name: string;
  email: string;
  password: string;
  /** "Player" or "Parent of Kit Young" */
  role: string;
}

export interface ImportResult {
  created: number;
  guardiansLinked: number;
  /** Rows that were not imported, by position in the request (0-based), with the reason. */
  skipped: { index: number; name: string; reason: string }[];
  logins: ImportLogin[];
}

// ---------------------------------------------------------------------------
// Season stats
// ---------------------------------------------------------------------------

/** One player's season so far, as a manager sees it. */
export interface PlayerStats {
  memberId: Id;
  displayName: string;
  /** Past training sessions where the manager recorded attendance, and how many of those this player came to. */
  trainingAttended: number;
  trainingTotal: number;
  /** Matches already played (or past their start time), and how many this player had said they were available for. */
  matchesAvailable: number;
  matchesTotal: number;
  /** Minutes on the pitch in finished live matches. */
  seasonMinutes: number;
}

// ---------------------------------------------------------------------------
// Pre-match briefings
// ---------------------------------------------------------------------------

export interface BriefingLink {
  label: string;
  /** An http(s) address, e.g. a YouTube clip or a tactics page. */
  url: string;
}

/** Coaching notes and links a manager attaches to a match. */
export interface Briefing {
  fixtureId: Id;
  body: string;
  links: BriefingLink[];
  updatedAt: IsoDateTime;
  /** Whether the asking member has read this version; editing the briefing resets it. */
  seen?: boolean;
}

export interface NewBriefing {
  body: string;
  links: BriefingLink[];
}

/** One squad member's read receipt for the current version of a briefing. */
export interface BriefingRead {
  memberId: Id;
  seen: boolean;
}

// ---------------------------------------------------------------------------
// Live matchday
// ---------------------------------------------------------------------------

/** A substitution actually made during the match, `atSecond` seconds of playing time in. */
export interface LiveSubstitution {
  atSecond: number;
  slotId: string;
  offMemberId: Id;
  onMemberId: Id;
}

export type LiveStatus = 'running' | 'paused' | 'finished';

/** The state of a match being played: the clock and the changes made so far. */
export interface LiveMatch {
  fixtureId: Id;
  status: LiveStatus;
  /** Seconds of playing time so far (stops while paused). */
  elapsedSeconds: number;
  substitutions: LiveSubstitution[];
}

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------

export interface Announcement {
  id: Id;
  teamId: Id;
  /** Name of whoever posted it, e.g. "Alex Morgan". */
  authorName: string;
  title: string;
  body: string;
  createdAt: IsoDateTime;
}

export interface NewAnnouncement {
  title: string;
  body: string;
}

// ---------------------------------------------------------------------------
// Training sessions
// ---------------------------------------------------------------------------

export interface TrainingSession {
  id: Id;
  teamId: Id;
  startsAt: IsoDateTime;
  durationMinutes: number;
  venue: string;
  notes?: string;
}

export type NewTrainingSession = Omit<TrainingSession, 'id' | 'teamId'>;
export type TrainingSessionUpdate = Partial<NewTrainingSession>;

/** One squad member's answer for a session, and whether the manager marked them as attending. */
export interface TrainingResponse {
  sessionId: Id;
  memberId: Id;
  /** 'no_response' until they answer. */
  rsvp: AvailabilityStatus;
  /** Unset until the manager records attendance. */
  attended?: boolean;
}

/** Adding a fixture to a team's calendar. */
export type NewFixture = Omit<Fixture, 'id' | 'teamId'>;

export type FixtureUpdate = Partial<NewFixture>;

export type AvailabilityStatus = 'available' | 'unavailable' | 'maybe' | 'no_response';

export interface Availability {
  fixtureId: Id;
  memberId: Id;
  status: AvailabilityStatus;
  note?: string;
  updatedAt: IsoDateTime;
}

// ---------------------------------------------------------------------------
// Squad formats & formations
// ---------------------------------------------------------------------------

/** 5- and 7-a-side for younger kids, 11-a-side for older juniors and adults. */
export type SquadFormat = 5 | 7 | 11;

export interface FormationSlot {
  /** Stable id within the formation, e.g. "LB", "CM", "GK". */
  id: string;
  label: string;
  line: PositionLine;
  /**
   * Position on the pitch in percent. The pitch is drawn attacking upwards:
   * y = 0 is the attacking D (top), y = 100 is our own goal (bottom).
   */
  x: number;
  y: number;
}

export interface Formation {
  id: string;
  name: string;
  format: SquadFormat;
  slots: FormationSlot[];
  /** Present only for a team's saved custom formation; absent for built-ins. */
  teamId?: Id;
}

/** A point on our half of the pitch: x 0–100 left → right, y 0–100 halfway → our back line. */
export interface PitchPosition {
  x: number;
  y: number;
}

/**
 * A team's own placement of a formation's positions, overriding the automatic
 * layout slot by slot. Belongs to the position, not the player, so it holds
 * whoever plays there until the team resets it.
 */
export interface FormationLayout {
  formationId: string;
  positions: Record<string, PitchPosition>;
}

/** A coach-typed formation: line counts defence-first through attack (GK is implicit). */
export interface NewCustomFormation {
  name: string;
  lines: number[];
}

// ---------------------------------------------------------------------------
// Lineups & substitutions
// ---------------------------------------------------------------------------

export type SuggestionStrategy = 'fair' | 'strongest' | 'stamina';

export interface SlotAssignment {
  slotId: string;
  memberId: Id | null;
}

export interface Substitution {
  /** Match minute at which the change happens. */
  minute: number;
  slotId: string;
  offMemberId: Id;
  onMemberId: Id;
}

export interface Lineup {
  id: Id;
  fixtureId: Id;
  formationId: string;
  strategy: SuggestionStrategy | 'manual';
  starting: SlotAssignment[];
  bench: Id[];
  substitutions: Substitution[];
  sharedAt?: IsoDateTime;
  updatedAt: IsoDateTime;
}

// ---------------------------------------------------------------------------
// Suggestion engine
// ---------------------------------------------------------------------------

export interface SuggestionRequest {
  fixtureId: Id;
  formationId: string;
  strategy: SuggestionStrategy;
  /**
   * Manager overrides: slots the manager has already filled.
   * These always win — the engine plans around them.
   */
  locked?: SlotAssignment[];
}

export interface SuggestionResult {
  starting: SlotAssignment[];
  bench: Id[];
  substitutions: Substitution[];
  /** Projected minutes on pitch per member for this match. */
  projectedMinutes: Record<Id, number>;
  /** Human-readable notes, e.g. "No goalkeeper available". */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Membership & payments (Phase 1 records, Stripe in Phase 2)
// ---------------------------------------------------------------------------

export type BillingInterval = 'month' | 'quarter' | 'year';

export interface MembershipPlan {
  id: Id;
  clubId: Id;
  name: string;
  amountPence: number;
  interval: BillingInterval;
}

/** A club admin adding a membership plan. */
export interface NewMembershipPlan {
  name: string;
  amountPence: number;
  interval: BillingInterval;
}

/** Whether online payments are switched on (a Stripe account is connected). */
export interface PaymentsConfig {
  enabled: boolean;
}

/** Where to send the member to pay. Demo mode has no URL: the payment is simulated. */
export interface CheckoutSession {
  url?: string;
  demo?: boolean;
}

export interface MembershipRecord {
  memberId: Id;
  planId: Id;
  status: 'active' | 'overdue' | 'cancelled';
  nextPaymentDue?: IsoDateTime;
}

// ---------------------------------------------------------------------------
// Event chat: a group chat on each match and training session
// ---------------------------------------------------------------------------

export type EventKind = 'match' | 'training';

/** A lineup posted into a match chat: a snapshot of what the manager saved then. */
export interface LineupCard {
  teamName: string;
  opponent: string;
  startsAt: IsoDateTime;
  format: SquadFormat;
  durationMinutes: number;
  formation: Formation;
  /** The team's own placement of this formation, if they dragged players into place. */
  positions?: Record<string, PitchPosition>;
  starting: SlotAssignment[];
  bench: Id[];
  substitutions: Substitution[];
  /** The players in this lineup: names and numbers only. */
  players: { memberId: Id; displayName: string; shirtNumber?: number }[];
  /** Planned minutes per player. */
  minutes: Record<Id, number>;
}

export interface ChatMessage {
  id: Id;
  authorId: Id | null;
  /** e.g. "Alex Coach", "Sam Green" */
  authorName: string;
  /** e.g. "Manager", "Player", "Parent of Quinn G." */
  authorRole: string;
  /** An automatic reminder rather than something a person wrote. */
  system?: boolean;
  body: string;
  lineup?: LineupCard;
  createdAt: IsoDateTime;
}

export interface ChatThread {
  messages: ChatMessage[];
  /** Managers may remove anyone's message; everyone may remove their own. */
  canModerate: boolean;
}

export interface ChatUnread {
  kind: EventKind;
  eventId: Id;
  unread: number;
  total: number;
}

