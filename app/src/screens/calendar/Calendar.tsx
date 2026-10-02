import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EventKind, Fixture, Id, Me, Team, TrainingSession } from '@hockey/contracts';
import { api } from '../../api-client';
import { EventChat } from '../chat/EventChat';
import './calendar.css';

/** Your teams plus your children's, once each: everything whose schedule (and chats) you follow. */
export function followedTeams(me: Me): Team[] {
  const all = [...me.teams, ...me.children.flatMap((c) => c.teams)];
  return all.filter((t, i) => all.findIndex((u) => u.id === t.id) === i);
}

/** How often the calendar refreshes its unread-message counts. */
const UNREAD_POLL_MS = 30000;

type Entry =
  | { kind: 'match'; at: string; team: Team; fixture: Fixture }
  | { kind: 'training'; at: string; team: Team; session: TrainingSession };

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/** Everything coming up for the teams you manage, play in or follow, soonest first, grouped by day. */
export function Calendar({ me }: { me: Me }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [teamId, setTeamId] = useState<Id | 'all'>('all');
  const [failed, setFailed] = useState(false);
  const teams = useMemo(() => followedTeams(me), [me]);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [chat, setChat] = useState<{ kind: EventKind; eventId: Id; title: string; subtitle: string } | null>(null);

  const loadUnread = useCallback(async () => {
    const lists = await Promise.all(teams.map((t) => api.getChatUnread(t.id).catch(() => [])));
    setUnread(Object.fromEntries(lists.flat().map((u) => [`${u.kind}:${u.eventId}`, u.unread])));
  }, [teams]);

  useEffect(() => {
    loadUnread();
    const timer = setInterval(() => document.visibilityState === 'visible' && loadUnread(), UNREAD_POLL_MS);
    return () => clearInterval(timer);
  }, [loadUnread]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Include things that started in the last few hours.
      const from = new Date(Date.now() - 3 * 3600_000).toISOString();
      const perTeam = await Promise.all(
        teams.map(async (team): Promise<Entry[]> => {
          const [fixtures, sessions] = await Promise.all([api.getFixtures(team.id, from), api.getTrainingSessions(team.id, from)]);
          return [
            ...fixtures.map((fixture) => ({ kind: 'match' as const, at: fixture.startsAt, team, fixture })),
            ...sessions.map((session) => ({ kind: 'training' as const, at: session.startsAt, team, session })),
          ];
        }),
      );
      if (!cancelled) setEntries(perTeam.flat().sort((a, b) => a.at.localeCompare(b.at)));
    })().catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [teams]);

  const shown = useMemo(() => (entries ?? []).filter((e) => teamId === 'all' || e.team.id === teamId), [entries, teamId]);
  const days = useMemo(() => {
    const groups: { label: string; items: Entry[] }[] = [];
    for (const e of shown) {
      const label = day(e.at);
      const last = groups[groups.length - 1];
      if (last?.label === label) last.items.push(e);
      else groups.push({ label, items: [e] });
    }
    return groups;
  }, [shown]);

  if (failed) return <p className="muted">Could not load the calendar.</p>;
  if (!entries) return <div className="loading">Loading the calendar…</div>;

  return (
    <section className="calendar">
      {teams.length > 1 && (
        <div className="calendar__bar">
          <select value={teamId} aria-label="Team" onChange={(e) => setTeamId(e.target.value)}>
            <option value="all">All my teams</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {days.length === 0 && <p className="muted">Nothing coming up.</p>}
      {days.map((d) => (
        <div key={d.label} className="calendar__day">
          <h2 className="calendar__date">{d.label}</h2>
          <ul className="calendar__list">
            {d.items.map((e) => (
              <li key={e.kind === 'match' ? e.fixture.id : e.session.id} className={`calendar__item calendar__item--${e.kind}`}>
                <span className="calendar__time">{time(e.at)}</span>
                <div className="calendar__what">
                  {e.kind === 'match' ? (
                    <>
                      <strong>
                        {e.fixture.homeAway === 'home' ? 'Home' : 'Away'} vs {e.fixture.opponent}
                      </strong>
                      <span className="muted small">
                        {e.team.name} · {e.fixture.venue} · {e.fixture.format}-a-side
                      </span>
                    </>
                  ) : (
                    <>
                      <strong>Training</strong>
                      <span className="muted small">
                        {e.team.name} · {e.session.venue} · {e.session.durationMinutes} min
                        {e.session.notes ? ` · ${e.session.notes}` : ''}
                      </span>
                    </>
                  )}
                </div>
                <span className={`calendar__tag calendar__tag--${e.kind}`}>{e.kind === 'match' ? 'Match' : 'Training'}</span>
                <ChatButton
                  unread={unread[`${e.kind}:${e.kind === 'match' ? e.fixture.id : e.session.id}`] ?? 0}
                  onOpen={() =>
                    setChat(
                      e.kind === 'match'
                        ? { kind: 'match', eventId: e.fixture.id, title: `${e.team.name} vs ${e.fixture.opponent}`, subtitle: `${day(e.at)}, ${time(e.at)} · ${e.fixture.venue}` }
                        : { kind: 'training', eventId: e.session.id, title: `${e.team.name} training`, subtitle: `${day(e.at)}, ${time(e.at)} · ${e.session.venue}` },
                    )
                  }
                />
              </li>
            ))}
          </ul>
        </div>
      ))}

      {chat && (
        <EventChat
          me={me}
          {...chat}
          onClose={() => {
            setChat(null);
            loadUnread();
          }}
        />
      )}
    </section>
  );
}

function ChatButton({ unread, onOpen }: { unread: number; onOpen: () => void }) {
  return (
    <button type="button" className="btn calendar__chat" onClick={onOpen} aria-label={unread ? `Chat, ${unread} unread` : 'Chat'}>
      Chat
      {unread > 0 && <span className="calendar__badge">{unread > 99 ? '99+' : unread}</span>}
    </button>
  );
}
