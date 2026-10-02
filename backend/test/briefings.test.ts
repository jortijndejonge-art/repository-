import { describe, expect, it } from 'vitest';
import type { Briefing, NewBriefing } from '@hockey/contracts';
import type { Repository } from '../src/db/repository';
import { BriefingService, cleanLinks } from '../src/services/briefings';

/** The briefing methods of the repository in memory, with a controllable clock. */
function setup() {
  let now = Date.parse('2030-01-01T10:00:00Z');
  let stored: Briefing | null = null;
  const reads = new Map<string, string>();
  const iso = () => new Date(now).toISOString();
  const repo = {
    getBriefing: async () => (stored ? { ...stored } : null),
    saveBriefing: async (fixtureId: string, b: NewBriefing) => {
      stored = { fixtureId, body: b.body, links: b.links, updatedAt: iso() };
      return { ...stored };
    },
    markBriefingSeen: async (_f: string, memberId: string) => void reads.set(memberId, iso()),
    listBriefingReads: async () => [...reads].map(([memberId, seenAt]) => ({ memberId, seenAt })),
    listTeamPlayers: async () => [{ memberId: 'a' }, { memberId: 'b' }],
  };
  return { service: new BriefingService(repo as unknown as Repository), repo, advance: (s: number) => void (now += s * 1000) };
}

describe('briefing links', () => {
  it('keeps http(s) links, tidies the address and gives an unlabelled link its site name', () => {
    expect(cleanLinks([{ label: ' Pressing drill ', url: ' https://www.youtube.com/watch?v=abc ' }, { label: '', url: 'http://example.com' }])).toEqual([
      { label: 'Pressing drill', url: 'https://www.youtube.com/watch?v=abc' },
      { label: 'example.com', url: 'http://example.com/' },
    ]);
  });

  it('refuses scripts, other schemes, junk and too many links', () => {
    expect(() => cleanLinks([{ label: 'x', url: 'javascript:alert(1)' }])).toThrow(/http/);
    expect(() => cleanLinks([{ label: 'x', url: 'data:text/html,<b>hi</b>' }])).toThrow(/http/);
    expect(() => cleanLinks([{ label: 'x', url: 'not a link' }])).toThrow(/valid web address/);
    expect(() => cleanLinks(Array.from({ length: 11 }, () => ({ label: 'x', url: 'https://a.com' })))).toThrow(/at most 10/);
  });
});

describe('BriefingService', () => {
  it('needs some text or a link', async () => {
    const { service } = setup();
    await expect(service.save('fx', { body: '   ', links: [] })).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.save('fx', { body: 'Press high', links: [] })).resolves.toMatchObject({ body: 'Press high', seen: false });
  });

  it('returns null when there is no briefing', async () => {
    expect(await setup().service.get('fx', 'a')).toBeNull();
  });

  it('tracks who has seen it, and an edit sends everyone back to unseen', async () => {
    const { service, repo, advance } = setup();
    await service.save('fx', { body: 'Version one', links: [] });
    expect((await service.get('fx', 'a'))!.seen).toBe(false);

    advance(60);
    await repo.markBriefingSeen('fx', 'a');
    expect((await service.get('fx', 'a'))!.seen).toBe(true);
    expect((await service.get('fx', 'b'))!.seen).toBe(false);
    expect(await service.reads('fx', 'team')).toEqual([
      { memberId: 'a', seen: true },
      { memberId: 'b', seen: false },
    ]);

    advance(60);
    await service.save('fx', { body: 'Version two', links: [] });
    expect((await service.get('fx', 'a'))!.seen).toBe(false);
    expect((await service.reads('fx', 'team')).every((r) => !r.seen)).toBe(true);
  });
});
