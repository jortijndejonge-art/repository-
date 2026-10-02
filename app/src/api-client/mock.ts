import type { Announcement, Briefing, GuardianSummary, LiveMatch, LiveSubstitution, Availability, Fixture, TrainingResponse, TrainingSession, Formation, FormationLayout, Id, Lineup, Me, MembershipPlan, MembershipRecord, PlayerProfile } from '@hockey/contracts';
import * as demo from '@hockey/demo';
import { benchNow, pitchAt, secondsPlayed, buildCustomFormationSlots, formationsFor, getFormation, suggestLineup, validateLineCounts } from '@hockey/engine';
import { sessionStore } from './session';
import { ApiError, type ApiClient } from './types';

/**
 * In-browser stand-in for the backend, using the shared demo club. Lets the
 * app run (and be demoed) with no server. Data resets on reload.
 */
export function createMockClient(): ApiClient {
  const availability = demo.seedAvailability();
  const lineups = new Map<Id, Lineup>();
  const fixtures: Fixture[] = demo.fixtures.map((f) => ({ ...f }));
  const announcements: Announcement[] = [];
  const briefings = new Map<Id, Briefing>();
  const briefingSeen = new Map<string, string>(); // "fixtureId/memberId" -> when read
  // Live matches: playing time banked before the clock was last started, and when it was started (ms).
  const liveMatches = new Map<Id, { status: LiveMatch['status']; banked: number; resumedAt: number | null; subs: LiveSubstitution[] }>();
  const liveView = (fixtureId: Id): LiveMatch | null => {
    const l = liveMatches.get(fixtureId);
    if (!l) return null;
    const running = l.status === 'running' && l.resumedAt !== null;
    const elapsed = l.banked + (running ? Math.floor((Date.now() - l.resumedAt!) / 1000) : 0);
    return { fixtureId, status: l.status, elapsedSeconds: elapsed, substitutions: l.subs.map((s) => ({ ...s })) };
  };
  const guardians = new Map<string, GuardianSummary[]>();
  const trainingSessions: TrainingSession[] = [];
  const trainingResponses = new Map<string, TrainingResponse>();
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
    const f = fixtures.find((x) => x.id === id);
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
    return { member, club: demo.club, memberships, teams, children: [] };
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
    async signInWithPassword(email) {
      // Demo mode only: any password works for a demo member.
      const member = demo.members.find((m) => m.email?.toLowerCase() === email.trim().toLowerCase());
      if (!member) throw new ApiError(401, 'Wrong email or password');
      return this.verifySignIn(`mock:${member.id}`);
    },
    async changePassword() {
      return delay(undefined);
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
    async createPlayerLogin(_teamId, _id, email) {
      if (!email) throw new ApiError(400, 'Add an email address for this player first');
      return delay({ email: email.toLowerCase(), password: 'demo-password-123' });
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
    async getTeamStats(teamId) {
      const nowIso = new Date().toISOString();
      const pastSessions = trainingSessions.filter(
        (s) =>
          s.teamId === teamId &&
          s.startsAt < nowIso &&
          [...trainingResponses.values()].some((r) => r.sessionId === s.id && r.attended !== undefined),
      );
      const pastFixtures = fixtures.filter((f) => f.teamId === teamId && f.startsAt < nowIso);
      return delay(
        (squads.get(teamId) ?? []).map((p) => ({
          memberId: p.memberId,
          displayName: p.displayName,
          trainingAttended: pastSessions.filter((s) => trainingResponses.get(`${s.id}/${p.memberId}`)?.attended).length,
          trainingTotal: pastSessions.length,
          matchesAvailable: pastFixtures.filter((f) =>
            availability.some((a) => a.fixtureId === f.id && a.memberId === p.memberId && a.status === 'available'),
          ).length,
          matchesTotal: pastFixtures.length,
          seasonMinutes: p.seasonMinutes,
        })),
      );
    },
    async getBriefing(fixtureId, forMember) {
      const b = briefings.get(fixtureId);
      if (!b) return delay(null);
      const seenAt = briefingSeen.get(`${fixtureId}/${forMember ?? memberId}`);
      return delay({ ...b, seen: Boolean(seenAt && seenAt >= b.updatedAt) });
    },
    async saveBriefing(fixtureId, input) {
      for (const link of input.links) {
        if (!/^https?:\/\//i.test(link.url.trim())) throw new ApiError(400, 'Links must start with http:// or https://');
      }
      const saved: Briefing = { fixtureId, body: input.body.trim(), links: input.links, updatedAt: new Date().toISOString(), seen: false };
      briefings.set(fixtureId, saved);
      return delay({ ...saved });
    },
    async deleteBriefing(fixtureId) {
      briefings.delete(fixtureId);
      return delay(undefined);
    },
    async getBriefingReads(fixtureId) {
      const b = briefings.get(fixtureId);
      const squad = squads.get(fixture(fixtureId).teamId) ?? [];
      return delay(
        squad.map((p) => {
          const seenAt = briefingSeen.get(`${fixtureId}/${p.memberId}`);
          return { memberId: p.memberId, seen: Boolean(b && seenAt && seenAt >= b.updatedAt) };
        }),
      );
    },
    async markBriefingSeen(fixtureId, forMember) {
      briefingSeen.set(`${fixtureId}/${forMember ?? memberId}`, new Date(Date.now() + 1).toISOString());
      return delay(undefined);
    },
    async getLiveMatch(fixtureId) {
      return delay(liveView(fixtureId));
    },
    async liveAction(fixtureId, action) {
      const l = liveMatches.get(fixtureId);
      if (action === 'start') {
        if (l) throw new ApiError(409, 'This match has already been started');
        if (!lineups.get(fixtureId)) throw new ApiError(400, 'Save a lineup for this match before starting it');
        liveMatches.set(fixtureId, { status: 'running', banked: 0, resumedAt: Date.now(), subs: [] });
        return delay(liveView(fixtureId)!);
      }
      if (!l) throw new ApiError(404, 'This match has not been started');
      if (l.status === 'finished') {
        if (action === 'finish') return delay(liveView(fixtureId)!);
        throw new ApiError(409, 'The match is over');
      }
      const now = liveView(fixtureId)!.elapsedSeconds;
      if (action === 'pause' && l.status === 'running') Object.assign(l, { status: 'paused', banked: now, resumedAt: null });
      else if (action === 'resume' && l.status === 'paused') Object.assign(l, { status: 'running', resumedAt: Date.now() });
      else if (action === 'finish') {
        const lineup = lineups.get(fixtureId);
        if (lineup) {
          const f = fixture(fixtureId);
          const squad = squads.get(f.teamId) ?? [];
          for (const [id, seconds] of Object.entries(secondsPlayed(lineup.starting, l.subs, now))) {
            const p = squad.find((x) => x.memberId === id);
            if (p) p.seasonMinutes += Math.round(seconds / 60);
          }
        }
        Object.assign(l, { status: 'finished', banked: now, resumedAt: null });
      } else throw new ApiError(409, action === 'pause' ? 'The clock is not running' : 'The clock is not paused');
      return delay(liveView(fixtureId)!);
    },
    async liveSubstitute(fixtureId, slotId, offMemberId, onMemberId) {
      const l = liveMatches.get(fixtureId);
      const lineup = lineups.get(fixtureId);
      if (!l || !lineup) throw new ApiError(404, 'This match has not been started');
      if (l.status === 'finished') throw new ApiError(409, 'The match is over');
      if (pitchAt(lineup.starting, l.subs).get(slotId) !== offMemberId) throw new ApiError(409, 'That player is not in that position right now');
      if (!benchNow(lineup.starting, lineup.bench, l.subs).includes(onMemberId)) throw new ApiError(409, 'That player is not available on the bench');
      l.subs.push({ atSecond: liveView(fixtureId)!.elapsedSeconds, slotId, offMemberId, onMemberId });
      return delay(liveView(fixtureId)!);
    },
    async getGuardians(_teamId, childId) {
      return delay((guardians.get(childId) ?? []).map((g) => ({ ...g })));
    },
    async addGuardian(_teamId, childId, input) {
      const list = guardians.get(childId) ?? [];
      const existing = list.find((g) => g.email === input.email.trim().toLowerCase());
      const guardian: GuardianSummary = existing ?? {
        memberId: `parent-${Date.now().toString(36)}`,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email.trim().toLowerCase(),
      };
      if (!existing) guardians.set(childId, [...list, guardian]);
      return delay({ guardian: { ...guardian }, ...(existing ? {} : { password: 'demo-password-123' }) });
    },
    async getAnnouncements(teamId) {
      return delay(
        announcements
          .filter((a) => a.teamId === teamId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((a) => ({ ...a })),
      );
    },
    async postAnnouncement(teamId, input) {
      const author = memberId ? demo.members.find((x) => x.id === memberId) : undefined;
      const created: Announcement = {
        id: `an-${Date.now().toString(36)}`,
        teamId,
        authorName: author ? `${author.firstName} ${author.lastName}` : 'The club',
        createdAt: new Date().toISOString(),
        ...input,
      };
      announcements.push(created);
      return delay({ ...created });
    },
    async deleteAnnouncement(id) {
      const at = announcements.findIndex((a) => a.id === id);
      if (at < 0) throw new ApiError(404, 'Announcement not found');
      announcements.splice(at, 1);
      return delay(undefined);
    },
    async getTrainingSessions(teamId, from) {
      return delay(
        trainingSessions
          .filter((s) => s.teamId === teamId && (!from || s.startsAt >= from))
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
          .map((s) => ({ ...s })),
      );
    },
    async addTrainingSession(teamId, input) {
      const created: TrainingSession = { id: `tr-${Date.now().toString(36)}`, teamId, ...input };
      trainingSessions.push(created);
      return delay({ ...created });
    },
    async updateTrainingSession(id, update) {
      const s = trainingSessions.find((x) => x.id === id);
      if (!s) throw new ApiError(404, 'Training session not found');
      Object.assign(s, update);
      return delay({ ...s });
    },
    async deleteTrainingSession(id) {
      const at = trainingSessions.findIndex((s) => s.id === id);
      if (at < 0) throw new ApiError(404, 'Training session not found');
      trainingSessions.splice(at, 1);
      return delay(undefined);
    },
    async getTrainingResponses(sessionId) {
      const s = trainingSessions.find((x) => x.id === sessionId);
      if (!s) throw new ApiError(404, 'Training session not found');
      return delay(
        (squads.get(s.teamId) ?? []).map(
          (p) => ({ ...(trainingResponses.get(`${sessionId}/${p.memberId}`) ?? { sessionId, memberId: p.memberId, rsvp: 'no_response' as const }) }),
        ),
      );
    },
    async setTrainingRsvp(sessionId, id, status) {
      const key = `${sessionId}/${id}`;
      trainingResponses.set(key, { ...(trainingResponses.get(key) ?? { sessionId, memberId: id }), rsvp: status });
      return delay(undefined);
    },
    async setTrainingAttendance(sessionId, id, attended) {
      const key = `${sessionId}/${id}`;
      trainingResponses.set(key, { ...(trainingResponses.get(key) ?? { sessionId, memberId: id, rsvp: 'no_response' as const }), attended });
      return delay(undefined);
    },
    async getFixtures(teamId, from) {
      return delay(
        fixtures
          .filter((f) => f.teamId === teamId && (!from || f.startsAt >= from))
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
          .map((f) => ({ ...f })),
      );
    },
    async addFixture(teamId, input) {
      const created: Fixture = { id: `fx-${Date.now().toString(36)}`, teamId, ...input };
      fixtures.push(created);
      return delay({ ...created });
    },
    async updateFixture(id, update) {
      const f = fixture(id);
      Object.assign(f, update);
      return delay({ ...f });
    },
    async deleteFixture(id) {
      const at = fixtures.findIndex((f) => f.id === id);
      if (at < 0) throw new ApiError(404, 'Fixture not found');
      fixtures.splice(at, 1);
      lineups.delete(id);
      return delay(undefined);
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
