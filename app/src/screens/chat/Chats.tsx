import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EventKind, Id, Me } from '@hockey/contracts';
import { api } from '../../api-client';
import { followedTeams } from '../calendar/Calendar';
import { EventChat } from './EventChat';
import './chat.css';

interface Item {
  kind: EventKind;
  eventId: Id;
  at: string;
  title: string;
  subtitle: string;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Recent chats stay listed for a week after the event. */
const LOOK_BACK_MS = 7 * 24 * 3600_000;

/** Every event chat you can join — matches and training for your (and your children's) teams. Unread first. */
export function Chats({ me, onUnreadChange }: { me: Me; onUnreadChange?: () => void }) {
  const teams = useMemo(() => followedTeams(me), [me]);
  const [items, setItems] = useState<Item[] | null>(null);
  const [counts, setCounts] = useState<Record<string, { unread: number; total: number }>>({});
  const [open, setOpen] = useState<Item | null>(null);
  const [failed, setFailed] = useState(false);

  const loadCounts = useCallback(async () => {
    const lists = await Promise.all(teams.map((t) => api.getChatUnread(t.id).catch(() => [])));
    setCounts(Object.fromEntries(lists.flat().map((u) => [`${u.kind}:${u.eventId}`, { unread: u.unread, total: u.total }])));
  }, [teams]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const from = new Date(Date.now() - LOOK_BACK_MS).toISOString();
      const perTeam = await Promise.all(
        teams.map(async (team) => {
          const [fixtures, sessions] = await Promise.all([api.getFixtures(team.id, from), api.getTrainingSessions(team.id, from)]);
          return [
            ...fixtures.map((f): Item => ({
              kind: 'match',
              eventId: f.id,
              at: f.startsAt,
              title: `${team.name} vs ${f.opponent}`,
              subtitle: `${when(f.startsAt)} · ${f.venue}`,
            })),
            ...sessions.map((s): Item => ({
              kind: 'training',
              eventId: s.id,
              at: s.startsAt,
              title: `${team.name} training`,
              subtitle: `${when(s.startsAt)} · ${s.venue}`,
            })),
          ];
        }),
      );
      if (!cancelled) setItems(perTeam.flat());
    })().catch(() => !cancelled && setFailed(true));
    loadCounts();
    return () => {
      cancelled = true;
    };
  }, [teams, loadCounts]);

  const sorted = useMemo(() => {
    const key = (i: Item) => `${i.kind}:${i.eventId}`;
    const now = Date.now();
    return [...(items ?? [])]
      // Past events only while they still have a conversation.
      .filter((i) => Date.parse(i.at) > now - 3 * 3600_000 || (counts[key(i)]?.total ?? 0) > 0)
      .sort((a, b) => {
        const ua = counts[key(a)]?.unread ?? 0;
        const ub = counts[key(b)]?.unread ?? 0;
        if ((ua > 0) !== (ub > 0)) return ua > 0 ? -1 : 1;
        return a.at.localeCompare(b.at);
      });
  }, [items, counts]);

  if (failed) return <p className="muted">Could not load your chats.</p>;
  if (!items) return <div className="loading">Loading chats…</div>;

  return (
    <section className="chats">
      {sorted.length === 0 && <p className="muted">No matches or training coming up, so no chats yet.</p>}
      <ul className="chats__list">
        {sorted.map((i) => {
          const c = counts[`${i.kind}:${i.eventId}`];
          return (
            <li key={`${i.kind}:${i.eventId}`}>
              <button type="button" className={`chats__item chats__item--${i.kind}`} onClick={() => setOpen(i)}>
                <span className="chats__icon" aria-hidden="true">
                  {i.kind === 'match' ? 'M' : 'T'}
                </span>
                <span className="chats__text">
                  <strong>{i.title}</strong>
                  <span className="muted small">{i.subtitle}</span>
                  <span className="muted small">
                    {c?.total ? `${c.total} message${c.total === 1 ? '' : 's'}` : 'No messages yet'}
                  </span>
                </span>
                {c?.unread ? <span className="chats__badge">{c.unread > 99 ? '99+' : c.unread}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>

      {open && (
        <EventChat
          me={me}
          kind={open.kind}
          eventId={open.eventId}
          title={open.title}
          subtitle={open.subtitle}
          onClose={() => {
            setOpen(null);
            loadCounts();
            onUnreadChange?.();
          }}
        />
      )}
    </section>
  );
}
