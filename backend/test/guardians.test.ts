import { describe, expect, it } from 'vitest';
import type { Member, Role } from '@hockey/contracts';
import type { Repository } from '../src/db/repository';
import { AuthService } from '../src/services/auth';
import { Access } from '../src/services/access';
import { MemoryMailer } from '../src/services/mailer';

const config = { appUrl: 'http://app.test', magicLinkTtlMinutes: 15, sessionTtlDays: 30, exposeDevLinks: false };
const child: Member = { id: 'kid', clubId: 'club', firstName: 'Kit', lastName: 'Young' };

function fakeRepo() {
  const members = new Map<string, Member>([[child.id, child]]);
  const roles = new Map<string, Role[]>();
  const links = new Set<string>();
  const hashes = new Map<string, string>();
  let next = 1;
  const repo = {
    getMember: async (id: string) => members.get(id) ?? null,
    findMembersByEmail: async (email: string) => [...members.values()].filter((m) => m.email === email.trim().toLowerCase()),
    createMember: async (clubId: string, m: { firstName: string; lastName: string; email: string }) => {
      const member = { id: `p${next++}`, clubId, firstName: m.firstName, lastName: m.lastName, email: m.email.toLowerCase() };
      members.set(member.id, member);
      return member;
    },
    addTeamRole: async (teamId: string, memberId: string, role: Role) => {
      const key = `${teamId}/${memberId}`;
      roles.set(key, [...new Set([...(roles.get(key) ?? []), role])]);
    },
    addGuardian: async (childId: string, guardianId: string) => void links.add(`${guardianId}>${childId}`),
    isGuardianOf: async (guardianId: string, childId: string) => links.has(`${guardianId}>${childId}`),
    getPasswordHash: async (id: string) => hashes.get(id) ?? null,
    setPasswordHash: async (id: string, h: string) => void hashes.set(id, h),
    createSession: async () => undefined,
    listChildren: async () => [],
    getClub: async () => ({ id: 'club', name: 'Club' }),
    listMemberships: async () => [],
    getTeam: async () => ({ id: 'u12', clubId: 'club', name: 'U12 Boys', ageGroup: 'U12', defaultFormat: 7 }),
  };
  return { repo: repo as unknown as Repository, members, roles, links, hashes };
}

describe('linking a parent to a player', () => {
  const guardianInput = { firstName: 'Pat', lastName: 'Young', email: 'Pat@Example.com' };

  it('creates a new parent with the guardian role, links them and gives a first password', async () => {
    const { repo, roles, links } = fakeRepo();
    const auth = new AuthService(repo, new MemoryMailer(), config);

    const result = await auth.addGuardian('u12', 'kid', guardianInput);

    expect(result.guardian).toMatchObject({ firstName: 'Pat', lastName: 'Young', email: 'pat@example.com' });
    expect(result.password?.length).toBeGreaterThanOrEqual(16);
    expect(roles.get(`u12/${result.guardian.memberId}`)).toEqual(['guardian']);
    expect(links.has(`${result.guardian.memberId}>kid`)).toBe(true);
    await expect(auth.loginWithPassword('pat@example.com', result.password!)).resolves.toBeTruthy();
  });

  it('reuses an existing parent (one parent, several children) without resetting their password', async () => {
    const { repo, members, links } = fakeRepo();
    members.set('sib', { id: 'sib', clubId: 'club', firstName: 'Sam', lastName: 'Young' });
    const auth = new AuthService(repo, new MemoryMailer(), config);

    const first = await auth.addGuardian('u12', 'kid', guardianInput);
    const second = await auth.addGuardian('u12', 'sib', guardianInput);

    expect(second.guardian.memberId).toBe(first.guardian.memberId);
    expect(second.password).toBeUndefined();
    expect(links.has(`${first.guardian.memberId}>kid`)).toBe(true);
    expect(links.has(`${first.guardian.memberId}>sib`)).toBe(true);
    await expect(auth.loginWithPassword('pat@example.com', first.password!)).resolves.toBeTruthy();
  });

  it('rejects a bad email and a player being their own guardian', async () => {
    const { repo, members } = fakeRepo();
    members.set('kid', { ...child, email: 'kit@example.com' });
    const auth = new AuthService(repo, new MemoryMailer(), config);
    await expect(auth.addGuardian('u12', 'kid', { ...guardianInput, email: 'nope' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(auth.addGuardian('u12', 'kid', { ...guardianInput, email: 'kit@example.com' })).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});

describe('who can answer for a player', () => {
  it('lets the player and their guardian, but not a stranger', async () => {
    const { repo, links } = fakeRepo();
    links.add('parent>kid');
    const access = new Access({
      ...(repo as object),
      getTeam: async () => ({ id: 'u12', clubId: 'club', name: 'U12', ageGroup: 'U12', defaultFormat: 7 }),
      getMember: async () => ({ id: 'x', clubId: 'club', firstName: 'X', lastName: 'Y' }),
      listMemberships: async () => [],
      isGuardianOf: repo.isGuardianOf,
    } as unknown as Repository);

    await expect(access.requireCanActFor('kid', 'kid', 'u12')).resolves.toBeUndefined();
    await expect(access.requireCanActFor('parent', 'kid', 'u12')).resolves.toBeUndefined();
    await expect(access.requireCanActFor('stranger', 'kid', 'u12')).rejects.toMatchObject({ statusCode: 403 });
  });
});
