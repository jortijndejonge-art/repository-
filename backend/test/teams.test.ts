import { describe, expect, it } from 'vitest';
import type { Team } from '@hockey/contracts';
import type { Repository } from '../src/db/repository';
import { TeamService } from '../src/services/teams';

function setup() {
  const teams: Team[] = [{ id: 't1', clubId: 'club', name: 'U12 Boys', ageGroup: 'U12', defaultFormat: 7 }];
  const roles: string[] = [];
  const repo = {
    listClubTeams: async () => teams,
    getTeam: async (id: string) => teams.find((t) => t.id === id) ?? null,
    addTeam: async (clubId: string, t: { name: string; ageGroup: Team['ageGroup']; defaultFormat: Team['defaultFormat'] }) => {
      const team = { id: `t${teams.length + 1}`, clubId, ...t };
      teams.push(team);
      return team;
    },
    updateTeam: async (id: string, patch: Partial<Team>) => {
      const team = teams.find((t) => t.id === id);
      if (!team) return null;
      Object.assign(team, patch);
      return team;
    },
    addTeamRole: async (teamId: string, memberId: string, role: string) => void roles.push(`${teamId}/${memberId}/${role}`),
  };
  return { service: new TeamService(repo as unknown as Repository), teams, roles };
}

describe('TeamService', () => {
  it('creates a team and makes the admin who made it its admin and manager', async () => {
    const { service, roles } = setup();
    const team = await service.create('club', 'alex', { name: '  U14 Girls ', ageGroup: 'U14', defaultFormat: 7 });
    expect(team).toMatchObject({ name: 'U14 Girls', ageGroup: 'U14', defaultFormat: 7, clubId: 'club' });
    expect(roles).toEqual([`${team.id}/alex/admin`, `${team.id}/alex/manager`]);
  });

  it('refuses a blank name, or a name another team already has (ignoring case)', async () => {
    const { service } = setup();
    await expect(service.create('club', 'alex', { name: '   ', ageGroup: 'U8', defaultFormat: 5 })).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.create('club', 'alex', { name: 'u12 boys', ageGroup: 'U12', defaultFormat: 7 })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('renames and changes a team, but not to another team\'s name, and not a team that does not exist', async () => {
    const { service, teams } = setup();
    await service.create('club', 'alex', { name: 'U14 Girls', ageGroup: 'U14', defaultFormat: 7 });
    const renamed = await service.update('t2', { name: 'U14 Girls A', defaultFormat: 11 });
    expect(renamed).toMatchObject({ name: 'U14 Girls A', defaultFormat: 11, ageGroup: 'U14' });
    await expect(service.update('t2', { name: 'U12 BOYS' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.update('t2', { name: '  ' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.update('nope', { name: 'X' })).rejects.toMatchObject({ statusCode: 404 });
    // changing only the format, or re-saving its own name, is fine
    await expect(service.update('t2', { name: 'u14 girls a' })).resolves.toBeTruthy();
    expect(teams.find((t) => t.id === 't2')!.name).toBe('u14 girls a');
  });
});
