import type { Id, Role } from '@hockey/contracts';
import type { Repository } from '../db/repository';
import { forbidden, notFound } from './errors';

/**
 * Role checks. A member with the admin role on any team is a club admin and
 * can manage every team in that club.
 */
export class Access {
  constructor(private readonly repo: Repository) {}

  private async context(memberId: Id, teamId: Id) {
    const [team, member, memberships] = await Promise.all([
      this.repo.getTeam(teamId),
      this.repo.getMember(memberId),
      this.repo.listMemberships(memberId),
    ]);
    if (!team) throw notFound('Team not found');
    const sameClub = member?.clubId === team.clubId;
    const roles = new Set<Role>(memberships.find((m) => m.teamId === teamId)?.roles ?? []);
    const clubAdmin = sameClub && memberships.some((m) => m.roles.includes('admin'));
    return { team, roles, clubAdmin, sameClub };
  }

  async isManager(memberId: Id, teamId: Id) {
    const { roles, clubAdmin } = await this.context(memberId, teamId);
    return clubAdmin || roles.has('manager') || roles.has('admin');
  }

  async requireManager(memberId: Id, teamId: Id) {
    if (!(await this.isManager(memberId, teamId))) throw forbidden('Only the team manager can do this');
  }

  /** Anyone on the team (any role) or a club admin. */
  async requireTeamMember(memberId: Id, teamId: Id) {
    const { roles, clubAdmin } = await this.context(memberId, teamId);
    if (!clubAdmin && roles.size === 0) throw forbidden('You are not in this team');
  }

  /** Team members (any role), club admins, and parents of a player in the team. */
  async isTeamViewer(memberId: Id, teamId: Id) {
    const { roles, clubAdmin } = await this.context(memberId, teamId);
    if (clubAdmin || roles.size > 0) return true;
    return (await this.repo.listChildren(memberId)).some((c) => c.teamIds.includes(teamId));
  }

  /** For read-only team views parents need too: the schedule and event chats. */
  async requireTeamViewer(memberId: Id, teamId: Id) {
    if (!(await this.isTeamViewer(memberId, teamId))) throw forbidden('You are not in this team');
  }

  async requireClubMember(memberId: Id, clubId: Id) {
    const member = await this.repo.getMember(memberId);
    if (member?.clubId !== clubId) throw forbidden('You are not in this club');
  }

  /** Club admins only: someone with the admin role on any team in this club. */
  async requireClubAdmin(memberId: Id, clubId: Id) {
    const [member, memberships] = await Promise.all([this.repo.getMember(memberId), this.repo.listMemberships(memberId)]);
    if (member?.clubId !== clubId || !memberships.some((m) => m.roles.includes('admin'))) {
      throw forbidden('Only a club admin can do this');
    }
  }

  /** A member can manage their own record; so can their guardians and the managers of their team. */
  async requireCanActFor(actorId: Id, memberId: Id, teamId: Id) {
    if (actorId === memberId) return;
    if (await this.repo.isGuardianOf(actorId, memberId)) return;
    await this.requireManager(actorId, teamId);
  }
}
