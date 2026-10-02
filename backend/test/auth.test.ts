import { describe, expect, it } from 'vitest';
import type { Member } from '@hockey/contracts';
import type { Repository } from '../src/db/repository';
import { generatePassword, hashPassword, verifyPassword } from '../src/auth/password';
import { AuthService } from '../src/services/auth';
import { MemoryMailer } from '../src/services/mailer';

const member: Member = { id: 'm1', clubId: 'club', firstName: 'Jo', lastName: 'Bloggs', email: 'jo@example.com' };
const config = { appUrl: 'http://app.test', magicLinkTtlMinutes: 15, sessionTtlDays: 30, exposeDevLinks: false };

function fakeRepo() {
  const hashes = new Map<string, string>();
  const sessions: string[] = [];
  const repo = {
    findMembersByEmail: async (email: string) => (email.trim().toLowerCase() === member.email ? [member] : []),
    getMember: async (id: string) => (id === member.id ? member : null),
    getClub: async () => ({ id: 'club', name: 'Club' }),
    listMemberships: async () => [],
    listChildren: async () => [],
    getTeam: async () => null,
    getPasswordHash: async (id: string) => hashes.get(id) ?? null,
    setPasswordHash: async (id: string, h: string) => void hashes.set(id, h),
    setMemberEmail: async (_id: string, e: string) => {
      if (e === 'taken@example.com') throw Object.assign(new Error('dup'), { code: '23505' });
      member.email = e.toLowerCase();
    },
    createSession: async (hash: string) => void sessions.push(hash),
  };
  return { repo: repo as unknown as Repository, hashes, sessions };
}

describe('password hashing', () => {
  it('verifies the right password and rejects wrong ones, with a new salt each time', async () => {
    const a = await hashPassword('correct horse battery');
    const b = await hashPassword('correct horse battery');
    expect(a).not.toBe(b);
    expect(a).not.toContain('correct horse');
    expect(await verifyPassword('correct horse battery', a)).toBe(true);
    expect(await verifyPassword('correct horse batterz', a)).toBe(false);
    expect(await verifyPassword('anything', null)).toBe(false);
  });

  it('generates different, long-enough passwords', () => {
    expect(generatePassword()).not.toBe(generatePassword());
    expect(generatePassword().length).toBeGreaterThanOrEqual(16);
  });
});

describe('password sign-in', () => {
  const service = () => {
    const f = fakeRepo();
    return { ...f, auth: new AuthService(f.repo, new MemoryMailer(), config) };
  };

  it('signs in with the right email and password (any email casing) and starts a session', async () => {
    const { auth, sessions } = service();
    await auth.setPasswordForEmail('jo@example.com', 'a long password!');
    const session = await auth.loginWithPassword(' JO@example.com ', 'a long password!');
    expect(session.me.member.id).toBe('m1');
    expect(session.accessToken.length).toBeGreaterThan(20);
    expect(sessions).toHaveLength(1);
  });

  it('gives the same error for a wrong password, an unknown email and an account with no password', async () => {
    const { auth } = service();
    await expect(auth.loginWithPassword('jo@example.com', 'whatever')).rejects.toMatchObject({ statusCode: 401, message: 'Wrong email or password' });
    await auth.setPasswordForEmail('jo@example.com', 'a long password!');
    await expect(auth.loginWithPassword('jo@example.com', 'wrong password')).rejects.toMatchObject({ message: 'Wrong email or password' });
    await expect(auth.loginWithPassword('nobody@example.com', 'a long password!')).rejects.toMatchObject({ message: 'Wrong email or password' });
  });

  it('locks an address out for a while after too many wrong guesses, even for the right password', async () => {
    const { auth } = service();
    await auth.setPasswordForEmail('jo@example.com', 'a long password!');
    for (let i = 0; i < 8; i++) await expect(auth.loginWithPassword('jo@example.com', 'nope')).rejects.toMatchObject({ statusCode: 401 });
    await expect(auth.loginWithPassword('jo@example.com', 'a long password!')).rejects.toMatchObject({ statusCode: 429 });
  });

  it('lets a signed-in member set a password, and needs the current one to change it', async () => {
    const { auth } = service();
    await expect(auth.setPassword('m1', 'short')).rejects.toMatchObject({ statusCode: 400 });
    await auth.setPassword('m1', 'first password 1');
    await expect(auth.setPassword('m1', 'second password 2')).rejects.toMatchObject({ statusCode: 401 });
    await expect(auth.setPassword('m1', 'second password 2', 'wrong')).rejects.toMatchObject({ statusCode: 401 });
    await auth.setPassword('m1', 'second password 2', 'first password 1');
    await expect(auth.loginWithPassword('jo@example.com', 'second password 2')).resolves.toBeTruthy();
    await expect(auth.loginWithPassword('jo@example.com', 'first password 1')).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe('a manager creating a player sign-in', () => {
  it('sets the email if given, creates a random password and lets the player sign in with it', async () => {
    const f = fakeRepo();
    (member as { email?: string }).email = undefined;
    const auth = new AuthService(f.repo, new MemoryMailer(), config);
    await expect(auth.createPlayerLogin('m1')).rejects.toMatchObject({ statusCode: 400 });
    const login = await auth.createPlayerLogin('m1', 'Jo@Example.com');
    expect(login.email).toBe('jo@example.com');
    expect(login.password.length).toBeGreaterThanOrEqual(16);
    await expect(auth.loginWithPassword('jo@example.com', login.password)).resolves.toBeTruthy();
    const again = await auth.createPlayerLogin('m1');
    expect(again.password).not.toBe(login.password);
    await expect(auth.loginWithPassword('jo@example.com', login.password)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('refuses an email another member already uses', async () => {
    const f = fakeRepo();
    const auth = new AuthService(f.repo, new MemoryMailer(), config);
    await expect(auth.createPlayerLogin('m1', 'taken@example.com')).rejects.toMatchObject({ statusCode: 409 });
  });
});
