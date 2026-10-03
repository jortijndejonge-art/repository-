import type { ChaseResult, Fixture, Id, PlayerProfile } from '@hockey/contracts';
import type { Repository } from '../db/repository';
import { conflict, notFound } from './errors';
import type { Mailer } from './mailer';

const HOUR = 3_600_000;
/** Never remind about the same match more than once in this long, however it was triggered. */
const MIN_GAP_MS = 20 * HOUR;
/** The automatic check reminds about matches starting within this long. */
const LOOK_AHEAD_MS = 72 * HOUR;

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });

/**
 * Chases players (and their parents) who have not said whether they can play, so the manager does not have to.
 * The reminder goes into the match chat, which everyone on the team sees, and by email too once an email
 * provider is connected.
 */
export class ChaseService {
  constructor(
    private readonly repo: Repository,
    private readonly mailer: Mailer,
    private readonly appUrl: string,
    /** True only when real email is set up; otherwise the chat message is the whole reminder. */
    private readonly emailEnabled: boolean,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Squad players who have no answer for this match yet. */
  async waitingOn(fixtureId: Id): Promise<PlayerProfile[]> {
    const fixture = await this.repo.getFixture(fixtureId);
    if (!fixture) throw notFound('Match not found');
    const [players, answers] = await Promise.all([this.repo.listTeamPlayers(fixture.teamId), this.repo.listAvailability(fixtureId)]);
    const answered = new Set(answers.filter((a) => a.status !== 'no_response').map((a) => a.memberId));
    return players.filter((p) => !answered.has(p.memberId));
  }

  /** Remind everyone still to answer. `force` skips the once-a-day limit for a manager who asks directly. */
  async chase(fixtureId: Id, opts: { force?: boolean } = {}): Promise<ChaseResult> {
    const fixture = await this.repo.getFixture(fixtureId);
    if (!fixture) throw notFound('Match not found');
    const waiting = await this.waitingOn(fixtureId);
    if (waiting.length === 0) return { reminded: 0, names: [] };

    const now = this.now();
    const claimed = await this.repo.claimChase(fixtureId, now, new Date(now.getTime() - (opts.force ? HOUR : MIN_GAP_MS)));
    if (!claimed) throw conflict(opts.force ? 'Everyone was reminded in the last hour. Give them a little longer.' : 'Already reminded recently.');

    const team = await this.repo.getTeam(fixture.teamId);
    const names = waiting.map((p) => p.displayName);
    const text =
      `Reminder: can you play ${team?.name ?? 'the team'} v ${fixture.opponent} on ${when(fixture.startsAt)}? ` +
      `Still waiting on ${names.join(', ')}. Players answer under Matches; parents under My children.`;
    await this.repo.addEventMessage({ kind: 'match', eventId: fixtureId, teamId: fixture.teamId, authorId: null, body: text, system: true });
    if (this.emailEnabled) await this.email(fixture, waiting);
    return { reminded: waiting.length, names };
  }

  /** Remind about matches in the next three days with unanswered players. Returns how many matches were chased. */
  async chaseUpcoming(): Promise<number> {
    const now = this.now();
    const fixtures = await this.repo.listFixturesBetween(now, new Date(now.getTime() + LOOK_AHEAD_MS));
    let chased = 0;
    for (const fixture of fixtures) {
      try {
        const result = await this.chase(fixture.id);
        if (result.reminded > 0) chased++;
      } catch {
        // Already reminded recently (or something odd with one match): carry on with the others.
      }
    }
    return chased;
  }

  private async email(fixture: Fixture, waiting: PlayerProfile[]) {
    const link = `${this.appUrl.replace(/\/+$/, '')}/`;
    const subject = `Can you play v ${fixture.opponent} on ${when(fixture.startsAt)}?`;
    const sent = new Set<string>();
    for (const player of waiting) {
      const [member, guardians] = await Promise.all([this.repo.getMember(player.memberId), this.repo.listGuardians(player.memberId)]);
      const recipients = [
        member?.email ? { email: member.email, name: member.firstName, about: null as string | null } : null,
        ...guardians.map((g) => (g.email ? { email: g.email, name: g.firstName, about: player.displayName } : null)),
      ];
      for (const r of recipients) {
        if (!r || sent.has(r.email)) continue;
        sent.add(r.email);
        await this.mailer.send({
          to: r.email,
          subject,
          text: `Hi ${r.name},\n\n${r.about ? `Please say whether ${r.about} can play` : 'Please say whether you can play'} v ${fixture.opponent} on ${when(fixture.startsAt)}.\n\nAnswer here: ${link}\n`,
        });
      }
    }
  }
}
