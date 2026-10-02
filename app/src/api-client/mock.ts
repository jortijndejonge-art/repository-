import type { Availability, Formation, FormationLayout, Id, Lineup, Me, MembershipPlan, MembershipRecord, PlayerProfile } from '@hockey/contracts';
import * as demo from '@hockey/demo';
import { buildCustomFormationSlots, formationsFor, getFormation, suggestLineup, validateLineCounts } from '@hockey/engine';
import { sessionStore } from './session';
import { ApiError, type ApiClient } from './types';

/**
 * In-browser stand-in for the backend, using the shared demo club. Lets the
 * app run (and be demoed) with no server. Data resets on reload.
 */
export function createMockClient(): ApiClient {
  const availability = demo.seedAvailability();
  const lineups = new Map<Id, Lineup>();
  const plans: MembershipPlan[] = demo.membershipPlans.map((p) => ({ ...p }));
  const myMemberships: MembershipRecord[] = [];
  const squads = new Map<Id, PlayerProfile[]>(
    Object.entries(demo.squads).map(([teamId, players]) => [teamId, players.map((p) => ({ ...p }))]),
  );
  const customFormations = new Map<Id, Formation[]>();
  const layouts = new Map<Id, Map<string, FormationLayout>>();
  let memberId: Id | null = sessionStore.get()?.replace(/^mock:/, '') ?? null;

  const delay = <T>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), 60));
  const fixture = (id: Id) => {
    const f = demo.fixtures.find((x) => x.id === id);
    if (!f) throw new ApiError(404, 'Fixture not found');
    return f;
  };
  const resolveFormation = (teamId: Id, formationId: string): Formation => {
    const custom = (customFormations.get(teamId) ?? []).find((f) => f.id === formationId);
    if (custom) return custom;
    try {
      return getFormation(formationId);
    } catch {
      throw new ApiError(404, `Unknown formation: ${formationId}`);
    }
  };

  function meFor(id: Id): Me {
    const member = demo.members.find((m) => m.id === id);
    if (!member) throw new ApiError(401, 'Sign in required');
    const memberships = demo.memberships.filter((m) => m.memberId === id);
    const teams = demo.teams.filter((t) => memberships.some((m) => m.teamId === t.id));
    return { member, club: demo.club, memberships, teams };
  }

  return {
    mode: 'mock',
    async requestSignIn(email) {
      const member = demo.members.find((m) => m.email?.toLowerCase() === email.trim().toLowerCase());
      return delay(member ? { devLink: `${location.origin}${import.meta.env.BASE_URL}auth/verify?token=mock:${member.id}` } : {});
    },
    async verifySignIn(token) {
      const id = token.replace(/^mock:/, '');
      const me = meFor(id);
      memberId = id;
      sessionStore.set(`mock:${id}`);
      return delay({ accessToken: token, me });
    },
    async signOut() {
      memberId = null;
      sessionStore.clear();
    },
    async me() {
      if (!memberId) throw new ApiError(401, 'Sign in required');
      return delay(meFor(memberId));
    },
    async getSquad(teamId) {
      return delay((squads.get(teamId) ?? []).map((p) => ({ ...p })));
    },
    async addPlayer(teamId, player) {
      const squad = squads.get(teamId) ?? [];
      const profile: PlayerProfile = {
        memberId: `new-${Date.now().toString(36)}-${squad.length}`,
        displayName: player.displayName ?? `${player.firstName} ${player.lastName.charAt(0)}.`,
        shirtNumber: player.shirtNumber,
        positions: player.positions,
        skill: player.skill,
        stamina: player.stamina,
        seasonMinutes: 0,
      };
      squads.set(teamId, [...squad, profile]);
      return delay({ ...profile });
    },
    async updatePlayer(teamId, id, update) {
      const player = (squads.get(teamId) ?? []).find((p) => p.memberId === id);
      if (!player) throw new ApiError(404, 'Player not in this team');
      Object.assign(player, update);
      return delay({ ...player });
    },
    async getPaymentsConfig() {
      return delay({ enabled: true });
    },
    async getMembershipPlans() {
      return delay(plans.map((p) => ({ ...p })));
    },
    async createMembershipPlan(clubId, plan) {
      const created: MembershipPlan = { id: `plan-${Date.now().toString(36)}`, clubId, ...plan };
      plans.push(created);
      return delay({ ...created });
    },
    async getMyMemberships() {
      return delay(myMemberships.map((r) => ({ ...r })));
    },
    async startCheckout(planId) {
      const plan = plans.find((p) => p.id === planId);
      if (!plan || !memberId) throw new ApiError(404, 'Membership plan not found');
      const due = new Date();
      due.setMonth(due.getMonth() + (plan.interval === 'month' ? 1 : plan.interval === 'quarter' ? 3 : 12));
      const record: MembershipRecord = { memberId, planId, status: 'active', nextPaymentDue: due.toISOString() };
      const at = myMemberships.findIndex((r) => r.planId === planId);
      if (at >= 0) myMemberships[at] = record;
      else myMemberships.push(record);
      return delay({ demo: true });
    },
    async getFixtures(teamId, from) {
      return delay(demo.fixtures.filter((f) => f.teamId === teamId && (!from || f.startsAt >= from)));
    },
    async getAvailability(fixtureId) {
      return delay(availability.filter((a) => a.fixtureId === fixtureId).map((a) => ({ ...a })));
    },
    async setAvailability(fixtureId, id, status) {
      const existing = availability.find((a) => a.fixtureId === fixtureId && a.memberId === id);
      const updated: Availability = { fixtureId, memberId: id, status, updatedAt: new Date().toISOString() };
      if (existing) Object.assign(existing, updated);
      else availability.push(updated);
      return delay(updated);
    },
    async getFormations(format) {
      return delay(formationsFor(format));
    },
    async getCustomFormations(teamId, format) {
      const all = customFormations.get(teamId) ?? [];
      return delay(format ? all.filter((f) => f.format === format) : all);
    },
    async createCustomFormation(teamId, input) {
      const check = validateLineCounts(input.lines);
      if (!check.ok) throw new ApiError(400, check.error);
      const formation: Formation = {
        id: `custom-${teamId}-${Date.now().toString(36)}`,
        name: input.name,
        format: check.format,
        slots: buildCustomFormationSlots(input.lines),
        teamId,
      };
      const existing = customFormations.get(teamId) ?? [];
      customFormations.set(teamId, [...existing, formation]);
      return delay(formation);
    },
    async getFormationLayouts(teamId) {
      return delay([...(layouts.get(teamId)?.values() ?? [])]);
    },
    async saveFormationLayout(teamId, layout) {
      const formation = resolveFormation(teamId, layout.formationId);
      const slotIds = new Set(formation.slots.map((s) => s.id));
      if (Object.keys(layout.positions).some((id) => !slotIds.has(id))) throw new ApiError(400, 'Unknown position');
      const team = layouts.get(teamId) ?? new Map<string, FormationLayout>();
      team.set(layout.formationId, layout);
      layouts.set(teamId, team);
      return delay(layout);
    },
    async resetFormationLayout(teamId, formationId) {
      layouts.get(teamId)?.delete(formationId);
      await delay(undefined);
    },
    async suggest(request) {
      const f = fixture(request.fixtureId);
      const available = new Set(
        availability.filter((a) => a.fixtureId === f.id && a.status === 'available').map((a) => a.memberId),
      );
      return delay(
        suggestLineup({
          players: (demo.squads[f.teamId] ?? []).filter((p) => available.has(p.memberId)),
          formation: resolveFormation(f.teamId, request.formationId),
          strategy: request.strategy,
          durationMinutes: f.durationMinutes,
          periods: f.periods,
          locked: request.locked,
        }),
      );
    },
    async getLineup(fixtureId) {
      return delay(lineups.get(fixtureId) ?? null);
    },
    async saveLineup(fixtureId, draft) {
      const saved: Lineup = {
        ...draft,
        id: `lineup-${fixtureId}`,
        fixtureId,
        sharedAt: lineups.get(fixtureId)?.sharedAt,
        updatedAt: new Date().toISOString(),
      };
      lineups.set(fixtureId, saved);
      return delay(saved);
    },
    async shareLineup(fixtureId, memberIds) {
      const lineup = lineups.get(fixtureId);
      if (!lineup) throw new ApiError(409, 'Save the lineup before sharing it');
      lineup.sharedAt = new Date().toISOString();
      return delay({ sharedWith: memberIds.length });
    },
  };
}
