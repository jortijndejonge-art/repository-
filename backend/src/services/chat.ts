import type { ChatMessage, ChatThread, ChatUnread, EventKind, Id, LineupCard } from '@hockey/contracts';
import { minutesFromPlan } from '@hockey/engine';
import type { Repository, StoredMessage } from '../db/repository';
import type { Access } from './access';
import { badRequest, conflict, forbidden, notFound } from './errors';
import type { LineupService } from './lineups';

const MAX_LENGTH = 2000;

/**
 * Group chat on each match and training session. Everyone who can see the
 * team's schedule (players, their parents, managers) reads and posts; there
 * are no private messages. Managers can remove any message, authors their own.
 */
export class ChatService {
  constructor(
    private readonly repo: Repository,
    private readonly access: Access,
    private readonly lineups: LineupService,
  ) {}

  /** The team an event belongs to (404 if the event doesn't exist). */
  async eventTeam(kind: EventKind, eventId: Id): Promise<Id> {
    if (kind === 'match') {
      const fixture = await this.repo.getFixture(eventId);
      if (!fixture) throw notFound('Match not found');
      return fixture.teamId;
    }
    const session = await this.repo.getTrainingSession(eventId);
    if (!session) throw notFound('Training session not found');
    return session.teamId;
  }

  /** Read the chat (and mark it read for this member). */
  async thread(kind: EventKind, eventId: Id, memberId: Id): Promise<ChatThread> {
    const teamId = await this.eventTeam(kind, eventId);
    await this.access.requireTeamViewer(memberId, teamId);
    const [stored, canModerate] = await Promise.all([
      this.repo.listEventMessages(kind, eventId),
      this.access.isManager(memberId, teamId),
    ]);
    await this.repo.markEventChatRead(kind, eventId, memberId);
    return { messages: await this.withRoles(stored, teamId), canModerate };
  }

  async post(kind: EventKind, eventId: Id, memberId: Id, body: string): Promise<ChatMessage> {
    const teamId = await this.eventTeam(kind, eventId);
    await this.access.requireTeamViewer(memberId, teamId);
    const text = body.trim();
    if (!text) throw badRequest('Write a message first');
    if (text.length > MAX_LENGTH) throw badRequest(`Keep messages under ${MAX_LENGTH} characters`);
    const stored = await this.repo.addEventMessage({ kind, eventId, teamId, authorId: memberId, body: text });
    await this.repo.markEventChatRead(kind, eventId, memberId);
    return (await this.withRoles([stored], teamId))[0]!;
  }

  /** A manager posts the saved lineup into the match chat, as a snapshot card. */
  async postLineup(fixtureId: Id, memberId: Id, note = ''): Promise<ChatMessage> {
    const fixture = await this.lineups.fixture(fixtureId);
    await this.access.requireManager(memberId, fixture.teamId);
    const lineup = await this.repo.getLineup(fixtureId);
    if (!lineup) throw conflict('Save the lineup before posting it');
    const [team, formation, layouts, squad] = await Promise.all([
      this.repo.getTeam(fixture.teamId),
      this.lineups.resolveFormation(fixture.teamId, lineup.formationId),
      this.repo.listFormationLayouts(fixture.teamId),
      this.repo.listTeamPlayers(fixture.teamId),
    ]);
    if (!formation) throw badRequest(`Unknown formation ${lineup.formationId}`);
    const named = new Set<Id>([
      ...(lineup.starting.map((s) => s.memberId).filter(Boolean) as Id[]),
      ...lineup.bench,
      ...lineup.substitutions.flatMap((s) => [s.onMemberId, s.offMemberId]),
    ]);
    const positions = layouts.find((l) => l.formationId === formation.id)?.positions;
    const card: LineupCard = {
      teamName: team?.name ?? '',
      opponent: fixture.opponent,
      startsAt: fixture.startsAt,
      format: fixture.format,
      durationMinutes: fixture.durationMinutes,
      formation,
      ...(positions ? { positions } : {}),
      starting: lineup.starting,
      bench: lineup.bench,
      substitutions: lineup.substitutions,
      // Names and numbers only — never ratings.
      players: squad
        .filter((p) => named.has(p.memberId))
        .map((p) => ({ memberId: p.memberId, displayName: p.displayName, ...(p.shirtNumber != null ? { shirtNumber: p.shirtNumber } : {}) })),
      minutes: minutesFromPlan(lineup.starting, lineup.substitutions, fixture.durationMinutes),
    };
    const text = note.trim().slice(0, MAX_LENGTH);
    const stored = await this.repo.addEventMessage({ kind: 'match', eventId: fixtureId, teamId: fixture.teamId, authorId: memberId, body: text, lineup: card });
    await this.repo.markEventChatRead('match', fixtureId, memberId);
    return (await this.withRoles([stored], fixture.teamId))[0]!;
  }

  async remove(messageId: Id, memberId: Id) {
    const msg = await this.repo.getEventMessage(messageId);
    if (!msg) throw notFound('Message not found');
    if (msg.authorId !== memberId && !(await this.access.isManager(memberId, msg.teamId))) {
      throw forbidden('You can only remove your own messages');
    }
    await this.repo.deleteEventMessage(messageId);
  }

  async unread(teamId: Id, memberId: Id): Promise<ChatUnread[]> {
    await this.access.requireTeamViewer(memberId, teamId);
    return this.repo.chatUnread(teamId, memberId);
  }

  /** Label each author by who they are to this team, so everyone can see who is talking. */
  private async withRoles(stored: StoredMessage[], teamId: Id): Promise<ChatMessage[]> {
    const roles = new Map<Id, string>();
    for (const id of new Set(stored.map((m) => m.authorId).filter(Boolean) as Id[])) roles.set(id, await this.roleOf(id, teamId));
    return stored.map((m) => ({
      id: m.id,
      authorId: m.authorId,
      authorName: m.authorName,
      authorRole: m.system ? 'Automatic' : m.authorId ? roles.get(m.authorId) ?? '' : '',
      ...(m.system ? { system: true } : {}),
      body: m.body,
      ...(m.lineup ? { lineup: m.lineup } : {}),
      createdAt: m.createdAt,
    }));
  }

  private async roleOf(memberId: Id, teamId: Id): Promise<string> {
    if (await this.access.isManager(memberId, teamId)) return 'Manager';
    const memberships = await this.repo.listMemberships(memberId);
    if (memberships.some((m) => m.teamId === teamId && m.roles.includes('player'))) return 'Player';
    const children = (await this.repo.listChildren(memberId)).filter((c) => c.teamIds.includes(teamId));
    if (children.length) return `Parent of ${children.map((c) => c.displayName).join(', ')}`;
    return 'Club';
  }
}
