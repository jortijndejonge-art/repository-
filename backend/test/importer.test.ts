import { describe, expect, it } from 'vitest';
import type { ImportRow, NewPlayer, PlayerProfile } from '@hockey/contracts';
import type { Repository } from '../src/db/repository';
import { ImportService } from '../src/services/importer';

function setup(existing: string[] = []) {
  const squad: PlayerProfile[] = existing.map((displayName, i) => ({ memberId: `old${i}`, displayName, positions: ['MID'], skill: 5, stamina: 5, seasonMinutes: 0 }));
  const usedEmails = new Set<string>();
  const added: NewPlayer[] = [];
  const logins: string[] = [];
  const guardians: { child: string; email: string }[] = [];
  const repo = {
    listTeamPlayers: async () => squad,
    addPlayer: async (_team: string, p: NewPlayer) => {
      if (p.email && usedEmails.has(p.email)) throw Object.assign(new Error('dup'), { code: '23505' });
      if (p.email) usedEmails.add(p.email);
      added.push(p);
      const profile = { memberId: `m${added.length}`, displayName: p.displayName ?? `${p.firstName} ${p.lastName.charAt(0)}.`, positions: p.positions, skill: p.skill, stamina: p.stamina, seasonMinutes: 0 } as PlayerProfile;
      return profile;
    },
  };
  const auth = {
    createPlayerLogin: async (id: string, email?: string) => {
      logins.push(id);
      return { email: email!, password: `pw-${id}` };
    },
    addGuardian: async (_t: string, child: string, g: { firstName: string; lastName: string; email: string }) => {
      guardians.push({ child, email: g.email });
      const already = guardians.filter((x) => x.email === g.email).length > 1;
      return { guardian: { memberId: `g-${g.email}`, firstName: g.firstName, lastName: g.lastName, email: g.email }, ...(already ? {} : { password: `gpw-${g.email}` }) };
    },
  };
  return { service: new ImportService(repo as unknown as Repository, auth as never), added, logins, guardians };
}

const row = (over: Partial<ImportRow> = {}): ImportRow => ({ firstName: 'Jo', lastName: 'Smith', ...over });

describe('ImportService', () => {
  it('creates players with sensible defaults when the sheet has no positions or ratings', async () => {
    const { service, added } = setup();
    const result = await service.run('t', { players: [row(), row({ firstName: 'Al', positions: ['GK'], shirtNumber: 1 })], createLogins: false });
    expect(result).toMatchObject({ created: 2, skipped: [], logins: [] });
    expect(added[0]).toMatchObject({ positions: ['MID'], skill: 5, stamina: 5 });
    expect(added[1]).toMatchObject({ positions: ['GK'], shirtNumber: 1 });
  });

  it('skips a player already in the squad (so importing the same file twice is safe) and says why', async () => {
    const { service, added } = setup(['Jo S.']);
    const result = await service.run('t', { players: [row(), row({ firstName: 'Bo' })], createLogins: false });
    expect(result.created).toBe(1);
    expect(added.map((p) => p.firstName)).toEqual(['Bo']);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({ index: 0, name: 'Jo Smith' });
    expect(result.skipped[0]!.reason).toMatch(/already in the squad/);
  });

  it('also skips a repeat within the same file', async () => {
    const { service } = setup();
    const result = await service.run('t', { players: [row(), row()], createLogins: false });
    expect(result.created).toBe(1);
    expect(result.skipped).toHaveLength(1);
  });

  it('keeps going after a row fails, reporting an email that is already taken', async () => {
    const { service } = setup();
    const result = await service.run('t', {
      players: [row({ email: 'a@x.com' }), row({ firstName: 'Bo', email: 'a@x.com' }), row({ firstName: 'Cy' })],
      createLogins: false,
    });
    expect(result.created).toBe(2);
    expect(result.skipped).toEqual([{ index: 1, name: 'Bo Smith', reason: 'That email address is already used by someone in the club.' }]);
  });

  it('creates player sign-ins only when asked, and only for players with an email', async () => {
    const off = setup();
    expect((await off.service.run('t', { players: [row({ email: 'a@x.com' })], createLogins: false })).logins).toEqual([]);
    const on = setup();
    const result = await on.service.run('t', { players: [row({ email: 'a@x.com' }), row({ firstName: 'Bo' })], createLogins: true });
    expect(result.logins).toEqual([{ name: 'Jo Smith', email: 'a@x.com', password: 'pw-m1', role: 'Player' }]);
  });

  it('links parents, returning a password only for a parent who is new, so siblings share one parent', async () => {
    const { service, guardians } = setup();
    const result = await service.run('t', {
      players: [row({ firstName: 'Kit', lastName: 'Young', guardianEmail: 'pat@x.com' }), row({ firstName: 'Sam', lastName: 'Young', guardianEmail: 'pat@x.com' })],
      createLogins: false,
    });
    expect(result.guardiansLinked).toBe(2);
    expect(guardians).toHaveLength(2);
    expect(result.logins).toHaveLength(1);
    expect(result.logins[0]).toMatchObject({ email: 'pat@x.com', role: 'Parent of Kit Young' });
  });

  it('handles a player with no last name', async () => {
    const { service, added } = setup();
    const result = await service.run('t', { players: [row({ lastName: '-' })], createLogins: false });
    expect(result.created).toBe(1);
    expect(added[0]!.lastName).toBe('-');
    expect(added[0]!.displayName).toBe('Jo');
  });
});
