import type { AuthSession, Id, Me } from '@hockey/contracts';
import type { Config } from '../config';
import type { Repository } from '../db/repository';
import { hashToken, newToken } from '../auth/tokens';
import type { Mailer } from './mailer';
import { generatePassword, hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from '../auth/password';
import { badRequest, conflict, HttpError, notFound, unauthorized } from './errors';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** Password guesses allowed per email address before a short lockout. */
const MAX_FAILED_LOGINS = 8;
const LOCKOUT_MINUTES = 15;

export class AuthService {
  private readonly failedLogins = new Map<string, { count: number; until: number }>();

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
    return this.startSession(memberId);
  }

  /** Sign in with an email and password. Wrong email and wrong password look the same. */
  async loginWithPassword(email: string, password: string): Promise<AuthSession> {
    const key = email.trim().toLowerCase();
    const attempts = this.failedLogins.get(key);
    if (attempts && attempts.count >= MAX_FAILED_LOGINS && attempts.until > Date.now()) {
      throw new HttpError(429, `Too many attempts. Try again in ${LOCKOUT_MINUTES} minutes, or use an email link.`);
    }
    let memberId: Id | null = null;
    const candidates = await this.repo.findMembersByEmail(key);
    for (const member of candidates.length ? candidates : [null]) {
      const hash = member ? await this.repo.getPasswordHash(member.id) : null;
      if ((await verifyPassword(password, hash)) && member) memberId = member.id;
    }
    if (!memberId) {
      const count = (attempts && attempts.until > Date.now() ? attempts.count : 0) + 1;
      this.failedLogins.set(key, { count, until: Date.now() + LOCKOUT_MINUTES * MINUTE });
      throw unauthorized('Wrong email or password');
    }
    this.failedLogins.delete(key);
    return this.startSession(memberId);
  }

  /** Set or change your password. Changing an existing one needs the current password. */
  async setPassword(memberId: Id, newPassword: string, currentPassword?: string): Promise<void> {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      throw badRequest(`Choose a password of at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    const existing = await this.repo.getPasswordHash(memberId);
    if (existing && !(await verifyPassword(currentPassword ?? '', existing))) {
      throw unauthorized('Your current password is wrong');
    }
    await this.repo.setPasswordHash(memberId, await hashPassword(newPassword));
  }

  /**
   * A manager creates a sign-in for a player: sets their email if one is given, then a fresh
   * random password. Returns it once, for the manager to hand over (the player can change it).
   */
  async createPlayerLogin(memberId: Id, email?: string): Promise<{ email: string; password: string }> {
    const member = await this.repo.getMember(memberId);
    if (!member) throw notFound('Member not found');
    const address = (email ?? member.email ?? '').trim();
    if (!address || !address.includes('@')) throw badRequest('Add an email address for this player first');
    if (address.toLowerCase() !== member.email?.toLowerCase()) {
      try {
        await this.repo.setMemberEmail(memberId, address);
      } catch (err) {
        if ((err as { code?: string }).code === '23505') throw conflict('Someone in the club already uses that email');
        throw err;
      }
    }
    const password = generatePassword();
    await this.repo.setPasswordHash(memberId, await hashPassword(password));
    return { email: address.toLowerCase(), password };
  }

  /** Used by the set-password command: returns the password that was set. */
  async setPasswordForEmail(email: string, password = generatePassword()): Promise<string> {
    const [member] = await this.repo.findMembersByEmail(email);
    if (!member) throw notFound('No member with that email');
    await this.repo.setPasswordHash(member.id, await hashPassword(password));
    return password;
  }

  private async startSession(memberId: Id): Promise<AuthSession> {
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
