import type {
  Availability,
  AvailabilityStatus,
  Club,
  Fixture,
  Member,
  MembershipPlan,
  PlayerProfile,
  PositionLine,
  Team,
  TeamMembership,
} from '@hockey/contracts';

/**
 * Demo data: one club, four teams across 5/7/11-a-side. Used by the web app's
 * mock API and by the backend's database seed, so both show the same club.
 * Emails use the reserved example.com domain.
 */

export const club: Club = { id: 'club-demo', name: 'Demo Hockey Club' };

export const teams: Team[] = [
  { id: 'u8', clubId: club.id, name: 'U8 Minis', ageGroup: 'U8', defaultFormat: 5 },
  { id: 'u12', clubId: club.id, name: 'U12 Girls', ageGroup: 'U12', defaultFormat: 7 },
  { id: 'u16', clubId: club.id, name: 'U16 Boys', ageGroup: 'U16', defaultFormat: 11 },
  { id: 'mens2', clubId: club.id, name: "Men's 2s", ageGroup: 'Adult', defaultFormat: 11 },
];

const FIRST_NAMES = [
  'Ava', 'Ben', 'Chloe', 'Dan', 'Ella', 'Finn', 'Grace', 'Harry', 'Isla', 'Jack', 'Kate', 'Leo',
  'Mia', 'Noah', 'Olivia', 'Pete', 'Quinn', 'Rosie', 'Sam', 'Tom', 'Uma', 'Vic', 'Will', 'Zara',
];
const SURNAMES = ['Adams', 'Brooks', 'Carter', 'Dixon', 'Evans', 'Fisher', 'Green', 'Hughes', 'Irving', 'Jones'];

/** Tiny deterministic PRNG so the demo looks the same on every load. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const fullNames = new Map<string, { firstName: string; lastName: string }>();

const SQUAD_SIZE: Record<string, number> = { u8: 8, u12: 11, u16: 15, mens2: 16 };

function makeSquad(teamId: string, seed: number): PlayerProfile[] {
  const rand = rng(seed);
  const size = SQUAD_SIZE[teamId] ?? 12;
  const lines: PositionLine[] = ['DEF', 'MID', 'FWD'];
  const players: PlayerProfile[] = [];
  for (let i = 0; i < size; i++) {
    const first = FIRST_NAMES[(i * 7 + seed) % FIRST_NAMES.length]!;
    const last = SURNAMES[(i * 3 + seed) % SURNAMES.length]!;
    let positions: PositionLine[];
    if (i === 0) positions = ['GK'];
    else if (i === 1 && size > 10) positions = ['DEF', 'GK'];
    else {
      const main = lines[i % 3]!;
      const alt = lines[(i + 1 + Math.floor(rand() * 2)) % 3]!;
      positions = rand() > 0.35 ? [main, alt] : [main];
    }
    fullNames.set(`${teamId}-p${i + 1}`, { firstName: first, lastName: last });
    players.push({
      memberId: `${teamId}-p${i + 1}`,
      displayName: `${first} ${last[0]}.`,
      shirtNumber: i + 1,
      positions,
      skill: 3 + Math.floor(rand() * 8), // 3–10
      stamina: 3 + Math.floor(rand() * 8),
      seasonMinutes: Math.floor(rand() * 8) * 20,
    });
  }
  return players;
}

export const squads: Record<string, PlayerProfile[]> = Object.fromEntries(
  teams.map((t, i) => [t.id, makeSquad(t.id, 11 + i * 5)]),
);

/** The demo coach: club admin and manager of every team. Sign in as coach@example.com. */
export const coach: Member = {
  id: 'coach',
  clubId: club.id,
  firstName: 'Alex',
  lastName: 'Coach',
  email: 'coach@example.com',
};

const emailFor = (id: string, first: string, last: string) =>
  `${first}.${last}.${id.split('-')[0]}`.toLowerCase() + '@example.com';

export const members: Member[] = [
  coach,
  ...Object.values(squads)
    .flat()
    .map((p) => {
      const name = fullNames.get(p.memberId)!;
      return { id: p.memberId, clubId: club.id, ...name, email: emailFor(p.memberId, name.firstName, name.lastName) };
    }),
];

export const memberships: TeamMembership[] = [
  ...teams.map((t) => ({ teamId: t.id, memberId: coach.id, roles: ['admin', 'manager'] as TeamMembership['roles'] })),
  ...teams.flatMap((t) =>
    (squads[t.id] ?? []).map((p) => ({ teamId: t.id, memberId: p.memberId, roles: ['player'] as TeamMembership['roles'] })),
  ),
];

export const membershipPlans: MembershipPlan[] = [
  { id: 'plan-junior', clubId: club.id, name: 'Junior', amountPence: 2500, interval: 'month' },
  { id: 'plan-adult', clubId: club.id, name: 'Adult', amountPence: 9000, interval: 'quarter' },
];

const MATCH_SHAPE: Record<string, { duration: number; periods: number }> = {
  u8: { duration: 30, periods: 2 },
  u12: { duration: 40, periods: 4 },
  u16: { duration: 60, periods: 4 },
  mens2: { duration: 60, periods: 4 },
};

const OPPONENTS = ['Riverside HC', 'Northgate HC', 'Oakfield HC', 'Kingsmere HC'];

function nextSaturday(hour: number): string {
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  d.setHours(hour, 30, 0, 0);
  return d.toISOString();
}

export const fixtures: Fixture[] = teams.map((t, i) => ({
  id: `fx-${t.id}`,
  teamId: t.id,
  opponent: OPPONENTS[i % OPPONENTS.length]!,
  startsAt: nextSaturday(9 + i * 2),
  venue: i % 2 === 0 ? 'Home pitch' : `${OPPONENTS[i % OPPONENTS.length]!.replace(' HC', '')} Astro`,
  homeAway: i % 2 === 0 ? 'home' : 'away',
  format: t.defaultFormat,
  durationMinutes: MATCH_SHAPE[t.id]!.duration,
  periods: MATCH_SHAPE[t.id]!.periods,
}));

export function seedAvailability(): Availability[] {
  const rand = rng(99);
  const out: Availability[] = [];
  for (const fixture of fixtures) {
    for (const p of squads[fixture.teamId] ?? []) {
      const r = rand();
      const status: AvailabilityStatus =
        r < 0.72 ? 'available' : r < 0.82 ? 'unavailable' : r < 0.9 ? 'maybe' : 'no_response';
      // Keep the first keeper available so the demo starts with a GK.
      out.push({
        fixtureId: fixture.id,
        memberId: p.memberId,
        status: p.positions[0] === 'GK' ? 'available' : status,
        updatedAt: new Date().toISOString(),
      });
    }
  }
  return out;
}
