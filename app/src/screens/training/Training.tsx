import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AvailabilityStatus,
  Id,
  Me,
  NewTrainingSession,
  PlayerProfile,
  Team,
  TrainingResponse,
  TrainingSession,
} from '@hockey/contracts';
import { api } from '../../api-client';
import { managedTeams, playingTeams } from '../../core/auth';
import { useToast } from '../../core/Toast';
import { TrainingDialog } from './TrainingDialog';
import '../fixtures/fixtures.css';
import './training.css';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const CHOICES: { status: AvailabilityStatus; label: string }[] = [
  { status: 'available', label: "I'm in" },
  { status: 'maybe', label: 'Maybe' },
  { status: 'unavailable', label: "Can't make it" },
];

const byStart = (a: TrainingSession, b: TrainingSession) => a.startsAt.localeCompare(b.startsAt);

export function Training({ me }: { me: Me }) {
  const manages = managedTeams(me).length > 0;
  return manages ? <ManagerView me={me} /> : <PlayerView me={me} />;
}

/* ---------------------------------------------------------------- manager */

function ManagerView({ me }: { me: Me }) {
  const toast = useToast();
  const teams = useMemo(() => managedTeams(me), [me]);
  const [teamId, setTeamId] = useState<Id>(teams[0]?.id ?? '');
  const [sessions, setSessions] = useState<TrainingSession[] | null>(null);
  const [squad, setSquad] = useState<PlayerProfile[]>([]);
  const [dialog, setDialog] = useState<{ session?: TrainingSession } | null>(null);
  const [openId, setOpenId] = useState<Id | null>(null);

  const load = useCallback(async () => {
    setSessions(null);
    setOpenId(null);
    const [s, players] = await Promise.all([api.getTrainingSessions(teamId), api.getSquad(teamId)]);
    setSessions(s);
    setSquad(players);
  }, [teamId]);

  useEffect(() => {
    load().catch(() => toast('Could not load training'));
  }, [load, toast]);

  const save = async (input: NewTrainingSession) => {
    const editing = dialog?.session;
    if (editing) {
      const updated = await api.updateTrainingSession(editing.id, input);
      setSessions((cur) => cur?.map((s) => (s.id === updated.id ? updated : s)).sort(byStart) ?? cur);
      toast('Training saved');
    } else {
      const added = await api.addTrainingSession(teamId, input);
      setSessions((cur) => [...(cur ?? []), added].sort(byStart));
      toast('Training added');
    }
    setDialog(null);
  };

  const remove = async (session: TrainingSession) => {
    if (!window.confirm(`Delete training on ${when(session.startsAt)}? Its RSVPs and attendance are deleted too.`)) return;
    try {
      await api.deleteTrainingSession(session.id);
      setSessions((cur) => cur?.filter((s) => s.id !== session.id) ?? cur);
      toast('Training deleted');
    } catch {
      toast('Could not delete the session');
    }
  };

  const now = new Date().toISOString();

  return (
    <section className="fixtures">
      <div className="fixtures__bar">
        {teams.length > 1 ? (
          <select value={teamId} aria-label="Team" onChange={(e) => setTeamId(e.target.value)}>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        ) : (
          <strong>{teams[0]!.name}</strong>
        )}
        <span className="spacer" />
        <button type="button" className="btn btn--primary" onClick={() => setDialog({})}>
          Add training
        </button>
      </div>

      {sessions === null ? (
        <p className="muted">Loading training…</p>
      ) : sessions.length === 0 ? (
        <p className="muted">No training sessions yet. Add the first one.</p>
      ) : (
        <ul className="fixtures__list">
          {sessions.map((s) => (
            <li key={s.id} className={`training__item${s.startsAt < now ? ' is-past' : ''}`}>
              <div className="fixtures__row training__head">
                <div>
                  <div className="fixtures__opponent">{when(s.startsAt)}</div>
                  <div className="muted small">
                    {s.venue} · {s.durationMinutes} min{s.notes ? ` · ${s.notes}` : ''}
                  </div>
                </div>
                <div className="fixtures__actions">
                  <button type="button" className="btn btn--ghost" onClick={() => setOpenId(openId === s.id ? null : s.id)}>
                    {openId === s.id ? 'Hide' : 'Attendance'}
                  </button>
                  <button type="button" className="btn btn--ghost" onClick={() => setDialog({ session: s })}>
                    Edit
                  </button>
                  <button type="button" className="btn btn--ghost" onClick={() => remove(s)}>
                    Delete
                  </button>
                </div>
              </div>
              {openId === s.id && <AttendancePanel sessionId={s.id} squad={squad} />}
            </li>
          ))}
        </ul>
      )}

      {dialog && <TrainingDialog session={dialog.session} onCancel={() => setDialog(null)} onSave={save} />}
    </section>
  );
}

const RSVP_LABEL: Record<AvailabilityStatus, string> = {
  available: 'In',
  maybe: 'Maybe',
  unavailable: 'Out',
  no_response: 'No reply',
};

function AttendancePanel({ sessionId, squad }: { sessionId: Id; squad: PlayerProfile[] }) {
  const toast = useToast();
  const [rows, setRows] = useState<TrainingResponse[] | null>(null);

  useEffect(() => {
    api
      .getTrainingResponses(sessionId)
      .then(setRows)
      .catch(() => toast('Could not load attendance'));
  }, [sessionId, toast]);

  if (!rows) return <p className="muted small training__panel">Loading…</p>;

  const name = (id: Id) => squad.find((p) => p.memberId === id)?.displayName ?? 'Player';
  const coming = rows.filter((r) => r.rsvp === 'available').length;
  const came = rows.filter((r) => r.attended).length;

  const mark = async (row: TrainingResponse, attended: boolean) => {
    setRows((cur) => cur?.map((r) => (r.memberId === row.memberId ? { ...r, attended } : r)) ?? cur);
    try {
      await api.setTrainingAttendance(sessionId, row.memberId, attended);
    } catch {
      setRows((cur) => cur?.map((r) => (r.memberId === row.memberId ? { ...r, attended: row.attended } : r)) ?? cur);
      toast('Could not save attendance');
    }
  };

  return (
    <div className="training__panel">
      <p className="muted small">
        {coming} saying they are in · {came} marked as attended
      </p>
      <ul className="training__players">
        {rows.map((r) => (
          <li key={r.memberId}>
            <label>
              <input type="checkbox" checked={r.attended === true} onChange={(e) => mark(r, e.target.checked)} />
              {name(r.memberId)}
            </label>
            <span className={`training__rsvp training__rsvp--${r.rsvp}`}>{RSVP_LABEL[r.rsvp]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ----------------------------------------------------------------- player */

interface SessionCard {
  team: Team;
  session: TrainingSession;
  responses: TrainingResponse[];
}

function PlayerView({ me }: { me: Me }) {
  const toast = useToast();
  const [cards, setCards] = useState<SessionCard[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const from = new Date(Date.now() - 3 * 3600_000).toISOString();
      const perTeam = await Promise.all(
        playingTeams(me).map(async (team) => {
          const sessions = await api.getTrainingSessions(team.id, from);
          return Promise.all(
            sessions.map(async (session) => ({ team, session, responses: await api.getTrainingResponses(session.id) })),
          );
        }),
      );
      if (!cancelled) setCards(perTeam.flat().sort((a, b) => byStart(a.session, b.session)));
    })().catch(() => toast('Could not load training'));
    return () => {
      cancelled = true;
    };
  }, [me, toast]);

  const respond = async (card: SessionCard, status: AvailabilityStatus) => {
    try {
      await api.setTrainingRsvp(card.session.id, me.member.id, status);
    } catch {
      toast('Could not save your answer');
      return;
    }
    setCards(
      (cur) =>
        cur?.map((c) =>
          c.session.id === card.session.id
            ? { ...c, responses: c.responses.map((r) => (r.memberId === me.member.id ? { ...r, rsvp: status } : r)) }
            : c,
        ) ?? cur,
    );
    toast(status === 'available' ? 'See you there!' : 'Thanks for letting us know');
  };

  if (!cards) return <div className="loading">Loading training…</div>;

  return (
    <div className="training__player">
      {cards.length === 0 && <p className="muted">No upcoming training for your teams.</p>}
      {cards.map((card) => {
        const mine = card.responses.find((r) => r.memberId === me.member.id)?.rsvp ?? 'no_response';
        const coming = card.responses.filter((r) => r.rsvp === 'available').length;
        return (
          <article key={card.session.id} className="match">
            <span className="muted small">{card.team.name}</span>
            <h3 className="match__opponent">Training · {when(card.session.startsAt)}</h3>
            <p className="match__meta muted">
              {card.session.venue} · {card.session.durationMinutes} min
            </p>
            {card.session.notes && <p>{card.session.notes}</p>}
            <div className="match__choices" role="radiogroup" aria-label="Will you be at training?">
              {CHOICES.map((c) => (
                <button
                  key={c.status}
                  type="button"
                  role="radio"
                  aria-checked={mine === c.status}
                  className={`choice choice--${c.status}${mine === c.status ? ' is-active' : ''}`}
                  onClick={() => respond(card, c.status)}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <p className="muted small">{coming} saying they are in</p>
          </article>
        );
      })}
    </div>
  );
}
