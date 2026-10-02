import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Fixture, Id, Lineup, LiveMatch, Me, PlayerProfile } from '@hockey/contracts';
import { benchNow, nextDueSubstitution, pitchAt, secondsPlayed } from '@hockey/engine';
import { api } from '../../api-client';
import { managedTeams } from '../../core/auth';
import { useToast } from '../../core/Toast';
import './matchday.css';

const clock = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Run a match from the touchline: clock, substitutions and minutes on the pitch, saved on the server. */
export function Matchday({ me }: { me: Me }) {
  const toast = useToast();
  const teams = useMemo(() => managedTeams(me), [me]);
  const [teamId, setTeamId] = useState<Id>(teams[0]?.id ?? '');
  const [fixtures, setFixtures] = useState<Fixture[] | null>(null);
  const [fixtureId, setFixtureId] = useState<Id>('');

  useEffect(() => {
    if (!teamId) return;
    let cancelled = false;
    setFixtures(null);
    // Matches from yesterday on, so a match played last night can still be finished off.
    api
      .getFixtures(teamId, new Date(Date.now() - 24 * 3600_000).toISOString())
      .then((list) => {
        if (cancelled) return;
        setFixtures(list);
        setFixtureId(list[0]?.id ?? '');
      })
      .catch(() => toast('Could not load matches'));
    return () => {
      cancelled = true;
    };
  }, [teamId, toast]);

  if (teams.length === 0) return <p className="muted">You don&apos;t manage any teams yet.</p>;
  const fixture = fixtures?.find((f) => f.id === fixtureId);

  return (
    <section className="matchday">
      <div className="matchday__bar">
        {teams.length > 1 && (
          <select value={teamId} aria-label="Team" onChange={(e) => setTeamId(e.target.value)}>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        {fixtures && fixtures.length > 0 && (
          <select value={fixtureId} aria-label="Match" onChange={(e) => setFixtureId(e.target.value)}>
            {fixtures.map((f) => (
              <option key={f.id} value={f.id}>
                {when(f.startsAt)} · {f.homeAway === 'home' ? 'Home' : 'Away'} vs {f.opponent}
              </option>
            ))}
          </select>
        )}
      </div>
      {fixtures === null && <p className="muted">Loading matches…</p>}
      {fixtures?.length === 0 && <p className="muted">No upcoming matches. Add one on the Fixtures tab.</p>}
      {fixture && <MatchControls key={fixture.id} fixture={fixture} teamId={teamId} />}
    </section>
  );
}

function MatchControls({ fixture, teamId }: { fixture: Fixture; teamId: Id }) {
  const toast = useToast();
  const [squad, setSquad] = useState<PlayerProfile[]>([]);
  const [lineup, setLineup] = useState<Lineup | null | undefined>(undefined);
  const [live, setLive] = useState<LiveMatch | null | undefined>(undefined);
  const [syncedAt, setSyncedAt] = useState(() => Date.now());
  const [, tick] = useState(0);
  const [offId, setOffId] = useState('');
  const [onId, setOnId] = useState('');
  const [busy, setBusy] = useState(false);

  const apply = useCallback((state: LiveMatch | null) => {
    setLive(state);
    setSyncedAt(Date.now());
  }, []);

  useEffect(() => {
    Promise.all([api.getSquad(teamId), api.getLineup(fixture.id), api.getLiveMatch(fixture.id)])
      .then(([players, l, state]) => {
        setSquad(players);
        setLineup(l);
        apply(state);
      })
      .catch(() => toast('Could not load the match'));
  }, [fixture.id, teamId, apply, toast]);

  // Redraw every second while the clock runs, and re-sync with the server now and then (other devices may act).
  useEffect(() => {
    const redraw = window.setInterval(() => tick((n) => n + 1), 1000);
    const resync = window.setInterval(() => {
      api.getLiveMatch(fixture.id).then(apply).catch(() => {});
    }, 15000);
    return () => {
      window.clearInterval(redraw);
      window.clearInterval(resync);
    };
  }, [fixture.id, apply]);

  const name = (id: Id) => squad.find((p) => p.memberId === id)?.displayName ?? 'Player';
  const elapsed = live
    ? live.elapsedSeconds + (live.status === 'running' ? Math.floor((Date.now() - syncedAt) / 1000) : 0)
    : 0;

  const run = async (action: () => Promise<LiveMatch>, done?: string) => {
    setBusy(true);
    try {
      apply(await action());
      if (done) toast(done);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  };

  if (lineup === undefined || live === undefined) return <p className="muted">Loading the match…</p>;
  if (!lineup) {
    return <p className="muted">There is no saved lineup for this match yet. Plan and save one on the Lineup planner tab first.</p>;
  }

  const subs = live?.substitutions ?? [];
  const pitch = pitchAt(lineup.starting, subs);
  const slots = lineup.starting.map((s) => s.slotId);
  const bench = benchNow(lineup.starting, lineup.bench, subs);
  const played = secondsPlayed(lineup.starting, subs, elapsed);
  const due = live && live.status !== 'finished' ? nextDueSubstitution(lineup.substitutions, lineup.starting, subs, elapsed) : undefined;
  const swap = (slotId: string, off: Id, on: Id) =>
    run(() => api.liveSubstitute(fixture.id, slotId, off, on), `${name(on)} on for ${name(off)}`);
  const offSlot = slots.find((s) => pitch.get(s) === offId);

  const row = (id: Id, extra?: string) => (
    <li key={id}>
      <span>
        {extra && <strong className="matchday__slot">{extra}</strong>} {name(id)}
      </span>
      <span className="muted small">{Math.floor((played[id] ?? 0) / 60)} min</span>
    </li>
  );

  return (
    <div className="matchday__body">
      <div className={`matchday__clock matchday__clock--${live?.status ?? 'idle'}`}>
        <div className="matchday__time" aria-live="off">
          {clock(elapsed)}
        </div>
        <div className="muted small">
          {!live
            ? 'Not started'
            : live.status === 'running'
              ? `Running · ${fixture.durationMinutes} min match`
              : live.status === 'paused'
                ? 'Paused'
                : 'Full time'}
        </div>
        <div className="matchday__buttons">
          {!live && (
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => run(() => api.liveAction(fixture.id, 'start'), 'Match started')}>
              Start match
            </button>
          )}
          {live?.status === 'running' && (
            <button type="button" className="btn" disabled={busy} onClick={() => run(() => api.liveAction(fixture.id, 'pause'))}>
              Pause
            </button>
          )}
          {live?.status === 'paused' && (
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => run(() => api.liveAction(fixture.id, 'resume'))}>
              Resume
            </button>
          )}
          {live && live.status !== 'finished' && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => {
                if (window.confirm('Finish the match? Minutes are added to each player\'s season total.')) {
                  run(() => api.liveAction(fixture.id, 'finish'), 'Full time. Minutes saved.');
                }
              }}
            >
              Finish match
            </button>
          )}
        </div>
      </div>

      {due && (
        <div className="matchday__due" role="status">
          <span>
            Planned change due: <strong>{name(due.onMemberId)}</strong> on for <strong>{name(due.offMemberId)}</strong> ({due.slotId})
          </span>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => swap(due.slotId, due.offMemberId, due.onMemberId)}>
            Make change
          </button>
        </div>
      )}

      <div className="matchday__lists">
        <div>
          <h3 className="matchday__heading">On the pitch</h3>
          <ul className="matchday__list">{slots.map((s) => (pitch.get(s) ? row(pitch.get(s)!, s) : null))}</ul>
        </div>
        <div>
          <h3 className="matchday__heading">Bench</h3>
          <ul className="matchday__list">{bench.length ? bench.map((id) => row(id)) : <li className="muted">Nobody on the bench</li>}</ul>
        </div>
      </div>

      {live && live.status !== 'finished' && bench.length > 0 && (
        <div className="matchday__swap">
          <h3 className="matchday__heading">Make a change</h3>
          <div className="matchday__swap-row">
            <select value={offId} aria-label="Player coming off" onChange={(e) => setOffId(e.target.value)}>
              <option value="">Coming off…</option>
              {slots.map((s) => (pitch.get(s) ? <option key={s} value={pitch.get(s)}>{`${s} · ${name(pitch.get(s)!)}`}</option> : null))}
            </select>
            <select value={onId} aria-label="Player coming on" onChange={(e) => setOnId(e.target.value)}>
              <option value="">Going on…</option>
              {bench.map((id) => (
                <option key={id} value={id}>
                  {name(id)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy || !offSlot || !onId}
              onClick={async () => {
                await swap(offSlot!, offId, onId);
                setOffId('');
                setOnId('');
              }}
            >
              Swap
            </button>
          </div>
        </div>
      )}

      {subs.length > 0 && (
        <div>
          <h3 className="matchday__heading">Changes made</h3>
          <ul className="matchday__list">
            {subs.map((s, i) => (
              <li key={i}>
                <span>
                  <strong className="matchday__slot">{s.slotId}</strong> {name(s.onMemberId)} on, {name(s.offMemberId)} off
                </span>
                <span className="muted small">{Math.floor(s.atSecond / 60)}&apos;</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
