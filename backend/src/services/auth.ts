import type { AuthSession, Id, Me } from '@hockey/contracts';
import type { Config } from '../config';
import type { Repository } from '../db/repository';
import { hashToken, newToken } from '../auth/tokens';
import type { Mailer } from './mailer';
import { notFound, unauthorized } from './errors';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export class AuthService {
  constructor(
    private readonly repo: Repository,
    private readonly mailer: Mailer,
    private readonly config: Config,
  ) {}

  /** Create a one-time sign-in link for a member and email it. Returns the link. */
  async sendMagicLink(memberId: Id, email: string, reason: 'sign-in' | 'invite' = 'sign-in'): Promise<string> {
    const token = newToken();
    await this.repo.createMagicLink(
      hashToken(token),
      memberId,
      new Date(Date.now() + this.config.magicLinkTtlMinutes * MINUTE),
    );
    const link = `${this.config.appUrl}/auth/verify?token=${encodeURIComponent(token)}`;
    const member = await this.repo.getMember(memberId);
    const club = member ? await this.repo.getClub(member.clubId) : null;
    await this.mailer.send({
      to: email,
      subject: reason === 'invite' ? `You've been added to ${club?.name ?? 'your club'}` : 'Your sign-in link',
      text: [
        `Hi ${member?.firstName ?? 'there'},`,
        '',
        reason === 'invite'
          ? `${club?.name ?? 'Your club'} now uses this app for availability and lineups. Tap to join — no password needed:`
          : 'Tap to sign in — no password needed:',
        link,
        '',
        `This link works once and expires in ${this.config.magicLinkTtlMinutes} minutes.`,
      ].join('\n'),
    });
    return link;
  }

  /**
   * Request a sign-in link by email. Always succeeds from the caller's point of
   * view so the endpoint can't be used to discover who is a member.
   */
  async requestSignIn(email: string): Promise<string | null> {
    const [member] = await this.repo.findMembersByEmail(email);
    if (!member?.email) return null;
    return this.sendMagicLink(member.id, member.email);
  }

  async invite(memberId: Id): Promise<string> {
    const member = await this.repo.getMember(memberId);
    if (!member) throw notFound('Member not found');
    if (!member.email) throw notFound('Member has no email address');
    return this.sendMagicLink(member.id, member.email, 'invite');
  }

  async verify(token: string): Promise<AuthSession> {
    const memberId = await this.repo.consumeMagicLink(hashToken(token));
    if (!memberId) throw unauthorized('This link is invalid, expired or already used');
    const accessToken = newToken();
    await this.repo.createSession(
      hashToken(accessToken),
      memberId,
      new Date(Date.now() + this.config.sessionTtlDays * DAY),
    );
    return { accessToken, me: await this.me(memberId) };
  }

  async authenticate(accessToken: string): Promise<Id | null> {
    return this.repo.getSessionMember(hashToken(accessToken));
  }

  async signOut(accessToken: string) {
    await this.repo.deleteSession(hashToken(accessToken));
  }

  async me(memberId: Id): Promise<Me> {
    const member = await this.repo.getMember(memberId);
    if (!member) throw unauthorized();
    const [club, memberships] = await Promise.all([
      this.repo.getClub(member.clubId),
      this.repo.listMemberships(memberId),
    ]);
    const teams = (await Promise.all(memberships.map((m) => this.repo.getTeam(m.teamId)))).filter(
      (t) => t !== null,
    );
    return { member, club: club!, memberships, teams };
  }
}
