import type { AgeGroup, Id, SquadFormat, Team } from '@hockey/contracts';
import type { Repository } from '../db/repository';
import { badRequest, notFound } from './errors';

export interface NewTeamInput {
  name: string;
  ageGroup: AgeGroup;
  defaultFormat: SquadFormat;
}

/** Adding and changing a club's teams. Only club admins do this (the route checks). */
export class TeamService {
  constructor(private readonly repo: Repository) {}

  /** Creates the team and makes the admin who created it a manager of it, so it shows up in their lists. */
  async create(clubId: Id, adminId: Id, input: NewTeamInput): Promise<Team> {
    const name = input.name.trim();
    if (!name) throw badRequest('Give the team a name');
    const existing = await this.repo.listClubTeams(clubId);
    if (existing.some((t) => t.name.toLowerCase() === name.toLowerCase())) throw badRequest(`There is already a team called "${name}"`);
    const team = await this.repo.addTeam(clubId, { ...input, name });
    await this.repo.addTeamRole(team.id, adminId, 'admin');
    await this.repo.addTeamRole(team.id, adminId, 'manager');
    return team;
  }

  async update(teamId: Id, patch: Partial<NewTeamInput>): Promise<Team> {
    const team = await this.repo.getTeam(teamId);
    if (!team) throw notFound('Team not found');
    const name = patch.name?.trim();
    if (patch.name !== undefined && !name) throw badRequest('Give the team a name');
    if (name && name.toLowerCase() !== team.name.toLowerCase()) {
      const others = await this.repo.listClubTeams(team.clubId);
      if (others.some((t) => t.id !== teamId && t.name.toLowerCase() === name.toLowerCase())) throw badRequest(`There is already a team called "${name}"`);
    }
    const updated = await this.repo.updateTeam(teamId, { ...patch, ...(name ? { name } : {}) });
    if (!updated) throw notFound('Team not found');
    return updated;
  }
}
