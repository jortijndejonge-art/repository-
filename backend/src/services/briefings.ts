import type { Briefing, BriefingLink, BriefingRead, Id, NewBriefing } from '@hockey/contracts';
import type { Repository } from '../db/repository';
import { badRequest } from './errors';

const MAX_LINKS = 10;

/** Keep only well-formed http(s) links, so a briefing can never carry a javascript: or data: address. */
export function cleanLinks(links: BriefingLink[]): BriefingLink[] {
  if (links.length > MAX_LINKS) throw badRequest(`Add at most ${MAX_LINKS} links`);
  return links.map((link) => {
    let url: URL;
    try {
      url = new URL(link.url.trim());
    } catch {
      throw badRequest(`"${link.url}" is not a valid web address`);
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw badRequest('Links must start with http:// or https://');
    return { label: link.label.trim() || url.hostname, url: url.toString() };
  });
}

export class BriefingService {
  constructor(private readonly repo: Repository) {}

  /** The briefing for a match, marked `seen` if `memberId` has read this version of it. */
  async get(fixtureId: Id, memberId: Id): Promise<Briefing | null> {
    const briefing = await this.repo.getBriefing(fixtureId);
    if (!briefing) return null;
    const reads = await this.repo.listBriefingReads(fixtureId);
    const mine = reads.find((r) => r.memberId === memberId);
    return { ...briefing, seen: Boolean(mine && mine.seenAt >= briefing.updatedAt) };
  }

  async save(fixtureId: Id, input: NewBriefing): Promise<Briefing> {
    const body = input.body.trim();
    const links = cleanLinks(input.links);
    if (!body && links.length === 0) throw badRequest('Write something or add a link');
    return { ...(await this.repo.saveBriefing(fixtureId, { body, links })), seen: false };
  }

  /** Who in the squad has read the current version. A new edit resets everyone to unseen. */
  async reads(fixtureId: Id, teamId: Id): Promise<BriefingRead[]> {
    const briefing = await this.repo.getBriefing(fixtureId);
    const [players, reads] = await Promise.all([this.repo.listTeamPlayers(teamId), this.repo.listBriefingReads(fixtureId)]);
    return players.map((p) => {
      const r = reads.find((x) => x.memberId === p.memberId);
      return { memberId: p.memberId, seen: Boolean(briefing && r && r.seenAt >= briefing.updatedAt) };
    });
  }
}
