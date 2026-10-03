import { useEffect, useMemo, useRef, useState } from 'react';
import type { ClubFixture, Fixture, NewFixture, Pitch, ScheduleConflict, SquadFormat, Team } from '@hockey/contracts';
import { clock, dayName, freeSlots, localParts } from '@hockey/engine';
import { api, clashesOf } from '../../api-client';

/** Usual match length for each squad format; the manager can change it. */
const DEFAULT_MINUTES: Record<SquadFormat, number> = { 5: 40, 7: 40, 11: 60 };
const TZ = 'Europe/London';

interface FixtureDialogProps {
  /** Present when editing. */
  fixture?: Fixture;
  team: Team;
  /** The club's pitches, to pick one and to check clashes against. */
  pitches: Pitch[];
  /** The club's coming matches, to suggest free times. */
  clubFixtures: ClubFixture[];
  onCancel: () => void;
  /** `force` saves even though the time clashes with something. */
  onSave: (fixture: NewFixture, opts?: { force?: boolean }) => Promise<void>;
}

/** An ISO time as the "YYYY-MM-DDTHH:mm" text a datetime-local input wants, in the browser's time zone. */
function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function FixtureDialog({ fixture, team, pitches, clubFixtures, onCancel, onSave }: FixtureDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [opponent, setOpponent] = useState(fixture?.opponent ?? '');
  const [startsAt, setStartsAt] = useState(fixture ? toLocalInput(fixture.startsAt) : '');
  const [venue, setVenue] = useState(fixture?.venue ?? '');
  const [homeAway, setHomeAway] = useState<Fixture['homeAway']>(fixture?.homeAway ?? 'home');
  const [format, setFormat] = useState<SquadFormat>(fixture?.format ?? team.defaultFormat);
  const [minutes, setMinutes] = useState(fixture?.durationMinutes ?? DEFAULT_MINUTES[team.defaultFormat]);
  const [periods, setPeriods] = useState(fixture?.periods ?? 4);
  const [pitchId, setPitchId] = useState(fixture?.pitchId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clashes, setClashes] = useState<ScheduleConflict[]>([]);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const home = homeAway === 'home';
  const usePitch = home && pitchId !== '';
  const when = startsAt ? new Date(startsAt).toISOString() : '';

  // As the time or pitch changes, ask the server what would clash, so it shows before saving.
  useEffect(() => {
    if (!when || !(minutes >= 5)) {
      setClashes([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api
        .checkFixtureConflicts(team.id, { id: fixture?.id, startsAt: when, durationMinutes: minutes, ...(usePitch ? { pitchId } : {}) })
        .then((c) => !cancelled && setClashes(c))
        .catch(() => !cancelled && setClashes([]));
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [when, minutes, pitchId, usePitch, team.id, fixture?.id]);

  // Free times for this age group: the earliest slot in each opening where a match of this length fits.
  const suggestions = useMemo(() => {
    if (!home || pitches.every((p) => p.slots.length === 0)) return [];
    return freeSlots(pitches, clubFixtures.filter((f) => f.id !== fixture?.id), {
      from: new Date(),
      days: 28,
      timeZone: TZ,
      durationMinutes: minutes,
      ageGroup: team.ageGroup,
    }).slice(0, 6);
  }, [home, pitches, clubFixtures, fixture?.id, minutes, team.ageGroup]);

  const changeFormat = (next: SquadFormat) => {
    // Keep a length the manager typed themselves; follow the format's usual one otherwise.
    if (minutes === DEFAULT_MINUTES[format]) setMinutes(DEFAULT_MINUTES[next]);
    setFormat(next);
  };

  const valid = opponent.trim() !== '' && venue.trim() !== '' && startsAt !== '' && minutes >= 5 && periods >= 1;

  const submit = async (force: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await onSave(
        {
          opponent: opponent.trim(),
          venue: venue.trim(),
          startsAt: when,
          homeAway,
          format,
          durationMinutes: minutes,
          periods,
          // An empty id on an edit clears the booking.
          ...(usePitch ? { pitchId } : fixture?.pitchId ? { pitchId: '' } : {}),
        },
        force ? { force: true } : undefined,
      );
    } catch (e) {
      const found = clashesOf(e);
      if (found) setClashes(found);
      else setError(e instanceof Error ? e.message : 'Could not save the fixture');
      setBusy(false);
    }
  };

  const pickSuggestion = (slot: (typeof suggestions)[number]) => {
    setStartsAt(toLocalInput(slot.startsAt));
    setPitchId(slot.pitchId);
    setHomeAway('home');
    const pitch = pitches.find((p) => p.id === slot.pitchId);
    if (pitch && !venue.trim()) setVenue(pitch.name);
  };

  return (
    <dialog ref={ref} className="dialog" onCancel={onCancel} aria-labelledby="fixture-title">
      <h2 id="fixture-title">{fixture ? 'Edit fixture' : 'Add fixture'}</h2>
      <div className="fixture-form">
        <label className="field">
          <span className="field__label">Opponent</span>
          <input value={opponent} maxLength={120} onChange={(e) => setOpponent(e.target.value)} />
        </label>

        <div className="fixture-form__row">
          <label className="field">
            <span className="field__label">Home or away</span>
            <select value={homeAway} onChange={(e) => setHomeAway(e.target.value as Fixture['homeAway'])}>
              <option value="home">Home</option>
              <option value="away">Away</option>
            </select>
          </label>
          {home && pitches.length > 0 && (
            <label className="field">
              <span className="field__label">Our pitch</span>
              <select value={pitchId} onChange={(e) => setPitchId(e.target.value)}>
                <option value="">Not decided</option>
                {pitches.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {suggestions.length > 0 && (
          <div className="fixture-suggest">
            <span className="field__label">Free times for {team.ageGroup} ({minutes} min)</span>
            <div className="fixture-suggest__chips">
              {suggestions.map((s) => {
                const p = localParts(s.startsAt, TZ);
                return (
                  <button key={`${s.pitchId}-${s.startsAt}`} type="button" className="rota__chip" onClick={() => pickSuggestion(s)}>
                    {dayName(p.weekday)} {s.date.slice(8)}/{s.date.slice(5, 7)} {clock(p.minute)}
                    <span className="muted"> · {s.pitchName}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <label className="field">
          <span className="field__label">Date and time</span>
          <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Venue</span>
          <input value={venue} maxLength={160} onChange={(e) => setVenue(e.target.value)} />
        </label>
        <div className="fixture-form__row">
          <label className="field">
            <span className="field__label">Format</span>
            <select value={format} onChange={(e) => changeFormat(Number(e.target.value) as SquadFormat)}>
              <option value={5}>5-a-side</option>
              <option value={7}>7-a-side</option>
              <option value={11}>11-a-side</option>
            </select>
          </label>
          <label className="field">
            <span className="field__label">Match length (minutes)</span>
            <input type="number" min={5} max={240} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
          </label>
        </div>
        <label className="field">
          <span className="field__label">Periods (quarters or halves)</span>
          <input type="number" min={1} max={8} value={periods} onChange={(e) => setPeriods(Number(e.target.value))} />
        </label>
      </div>

      {clashes.length > 0 && (
        <div className="fixture-clash" role="alert">
          <strong>Heads up: this time clashes</strong>
          <ul>
            {clashes.map((c, i) => (
              <li key={i}>{c.message}</li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <p className="squad-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog__actions">
        <span className="spacer" />
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn--primary" disabled={!valid || busy} onClick={() => submit(clashes.length > 0)}>
          {clashes.length > 0 ? 'Save anyway' : fixture ? 'Save changes' : 'Add fixture'}
        </button>
      </div>
    </dialog>
  );
}
