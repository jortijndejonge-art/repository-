import { useEffect, useMemo, useState } from 'react';
import type { ClubFixture, Me, Pitch } from '@hockey/contracts';
import { clock, dayName, findConflicts, instantAt, localParts } from '@hockey/engine';
import { api } from '../../api-client';
import { useToast } from '../../core/Toast';
import './schedule.css';

const TZ = 'Europe/London';
const DAY_MS = 86_400_000;

/** "2026-10-03" plus n days, as a date string. */
function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

const label = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

/** The whole club's week: every team's matches, which pitch they are on, what is still free, and anything clashing. */
export function Schedule({ me }: { me: Me }) {
  const toast = useToast();
  const today = localParts(new Date(), TZ);
  const [monday, setMonday] = useState(() => addDays(today.date, -today.weekday));
  const [fixtures, setFixtures] = useState<ClubFixture[] | null>(null);
  const [pitches, setPitches] = useState<Pitch[]>([]);
  const [ageGroup, setAgeGroup] = useState('all');

  useEffect(() => {
    let cancelled = false;
    setFixtures(null);
    // A day either side, so a clash with a match just outside the week still shows.
    const from = instantAt(addDays(monday, -1), 0, TZ);
    const to = instantAt(addDays(monday, 8), 0, TZ);
    Promise.all([api.getClubSchedule(me.club.id, from, to), api.getPitches(me.club.id)])
      .then(([f, p]) => {
        if (cancelled) return;
        setFixtures(f);
        setPitches(p);
      })
      .catch(() => !cancelled && toast('Could not load the schedule'));
    return () => {
      cancelled = true;
    };
  }, [monday, me.club.id, toast]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(monday, i)), [monday]);
  const groups = useMemo(() => [...new Set((fixtures ?? []).map((f) => f.ageGroup))], [fixtures]);

  const conflictsOf = (f: ClubFixture) =>
    findConflicts({
      candidate: { id: f.id, teamId: f.teamId, ageGroup: f.ageGroup, startsAt: f.startsAt, durationMinutes: f.durationMinutes, pitchId: f.pitchId },
      fixtures: fixtures ?? [],
      trainings: [],
      pitches,
      timeZone: TZ,
    });

  const shown = (fixtures ?? []).filter((f) => ageGroup === 'all' || f.ageGroup === ageGroup);
  const clashing = shown.filter((f) => conflictsOf(f).length > 0).length;
  const range = `${new Date(`${monday}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })} – ${new Date(`${addDays(monday, 6)}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}`;

  return (
    <section className="schedule">
      <div className="schedule__bar">
        <button type="button" className="btn btn--ghost" onClick={() => setMonday(addDays(monday, -7))} aria-label="Previous week">
          ‹
        </button>
        <strong className="schedule__range">{range}</strong>
        <button type="button" className="btn btn--ghost" onClick={() => setMonday(addDays(monday, 7))} aria-label="Next week">
          ›
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => setMonday(addDays(today.date, -today.weekday))}>
          This week
        </button>
        <span className="spacer" />
        {groups.length > 1 && (
          <select value={ageGroup} aria-label="Age group" onChange={(e) => setAgeGroup(e.target.value)}>
            <option value="all">All age groups</option>
            {groups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        )}
      </div>

      {fixtures === null ? (
        <p className="muted">Loading the week…</p>
      ) : (
        <>
          <p className={clashing ? 'schedule__summary schedule__summary--bad' : 'schedule__summary muted small'}>
            {shown.filter((f) => days.includes(localParts(f.startsAt, TZ).date)).length} matches this week
            {clashing ? ` · ${clashing} with a clash to sort out` : ' · no clashes'}
          </p>
          {days.map((date, i) => {
            const todays = shown.filter((f) => localParts(f.startsAt, TZ).date === date);
            const openings = pitches.flatMap((p) => p.slots.filter((s) => s.weekday === i && (ageGroup === 'all' || s.ageGroups.includes(ageGroup as never))).map((s) => ({ pitch: p, slot: s })));
            if (todays.length === 0 && openings.length === 0) return null;
            return (
              <div key={date} className="schedule__day">
                <h2 className="schedule__date">{label(date)}</h2>
                {todays.length > 0 && (
                  <ul className="schedule__list">
                    {todays.map((f) => {
                      const problems = conflictsOf(f);
                      const time = clock(localParts(f.startsAt, TZ).minute);
                      return (
                        <li key={f.id} className={`schedule__match${problems.length ? ' is-clash' : ''}`}>
                          <span className="schedule__time">{time}</span>
                          <div className="schedule__what">
                            <strong>
                              {f.teamName} <span className="muted">v {f.opponent}</span>
                            </strong>
                            <span className="muted small">
                              {f.homeAway === 'home' ? 'Home' : 'Away'} · {f.pitchName ?? (f.homeAway === 'home' ? 'no pitch chosen' : f.venue)} · {f.durationMinutes} min
                            </span>
                            {problems.map((c, j) => (
                              <span key={j} className="schedule__problem">
                                {c.message}
                              </span>
                            ))}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {openings.length > 0 && (
                  <ul className="schedule__open">
                    {openings.map(({ pitch, slot }) => {
                      const start = Date.parse(instantAt(date, slot.startMinute, TZ));
                      const end = start + (slot.endMinute - slot.startMinute) * 60_000;
                      const used = (fixtures ?? [])
                        .filter((f) => f.pitchId === pitch.id)
                        .map((f) => [Date.parse(f.startsAt), Date.parse(f.startsAt) + (f.durationMinutes + 10) * 60_000] as const)
                        .filter(([a, b]) => a < end && start < b)
                        .reduce((sum, [a, b]) => sum + (Math.min(b, end) - Math.max(a, start)), 0) / 60_000;
                      const free = Math.max(0, slot.endMinute - slot.startMinute - used);
                      return (
                        <li key={slot.id}>
                          <strong>{pitch.name}</strong> {clock(slot.startMinute)}–{clock(slot.endMinute)}
                          <span className="muted small"> · {slot.ageGroups.join(', ')} · </span>
                          <span className={free < 40 ? 'status-bad small' : 'status-good small'}>
                            {free >= 60 ? `${Math.floor(free / 60)}h${free % 60 ? ` ${free % 60}m` : ''} free` : free > 0 ? `${free} min free` : 'full'}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
          {shown.length === 0 && pitches.every((p) => p.slots.length === 0) && (
            <p className="muted">Nothing is planned for this week yet. Add matches on the Fixtures tab; admins set up pitches on the Pitches tab.</p>
          )}
        </>
      )}
      <p className="muted small">
        {dayName(0)} to {dayName(6)}, in UK time.
      </p>
    </section>
  );
}
