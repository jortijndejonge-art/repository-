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
export interface Me {
  member: Member;
  club: Club;
  memberships: TeamMembership[];
  teams: Team[];
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

export interface MembershipRecord {
  memberId: Id;
  planId: Id;
  status: 'active' | 'overdue' | 'cancelled';
  nextPaymentDue?: IsoDateTime;
}
