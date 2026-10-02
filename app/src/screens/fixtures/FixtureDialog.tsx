import { useEffect, useRef, useState } from 'react';
import type { Fixture, NewFixture, SquadFormat } from '@hockey/contracts';

/** Usual match length for each squad format; the manager can change it. */
const DEFAULT_MINUTES: Record<SquadFormat, number> = { 5: 40, 7: 40, 11: 60 };

interface FixtureDialogProps {
  /** Present when editing. */
  fixture?: Fixture;
  /** The team's usual format, used for a new fixture. */
  defaultFormat: SquadFormat;
  onCancel: () => void;
  onSave: (fixture: NewFixture) => Promise<void>;
}

/** An ISO time as the "YYYY-MM-DDTHH:mm" text a datetime-local input wants, in the browser's time zone. */
function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function FixtureDialog({ fixture, defaultFormat, onCancel, onSave }: FixtureDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [opponent, setOpponent] = useState(fixture?.opponent ?? '');
  const [startsAt, setStartsAt] = useState(fixture ? toLocalInput(fixture.startsAt) : '');
  const [venue, setVenue] = useState(fixture?.venue ?? '');
  const [homeAway, setHomeAway] = useState<Fixture['homeAway']>(fixture?.homeAway ?? 'home');
  const [format, setFormat] = useState<SquadFormat>(fixture?.format ?? defaultFormat);
  const [minutes, setMinutes] = useState(fixture?.durationMinutes ?? DEFAULT_MINUTES[defaultFormat]);
  const [periods, setPeriods] = useState(fixture?.periods ?? 4);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const changeFormat = (next: SquadFormat) => {
    // Keep a length the manager typed themselves; follow the format's usual one otherwise.
    if (minutes === DEFAULT_MINUTES[format]) setMinutes(DEFAULT_MINUTES[next]);
    setFormat(next);
  };

  const valid = opponent.trim() !== '' && venue.trim() !== '' && startsAt !== '' && minutes >= 5 && periods >= 1;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave({
        opponent: opponent.trim(),
        venue: venue.trim(),
        startsAt: new Date(startsAt).toISOString(),
        homeAway,
        format,
        durationMinutes: minutes,
        periods,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the fixture');
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className="dialog" onCancel={onCancel} aria-labelledby="fixture-title">
      <h2 id="fixture-title">{fixture ? 'Edit fixture' : 'Add fixture'}</h2>
      <div className="fixture-form">
        <label className="field">
          <span className="field__label">Opponent</span>
          <input value={opponent} maxLength={120} onChange={(e) => setOpponent(e.target.value)} />
        </label>
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
            <span className="field__label">Home or away</span>
            <select value={homeAway} onChange={(e) => setHomeAway(e.target.value as Fixture['homeAway'])}>
              <option value="home">Home</option>
              <option value="away">Away</option>
            </select>
          </label>
          <label className="field">
            <span className="field__label">Format</span>
            <select value={format} onChange={(e) => changeFormat(Number(e.target.value) as SquadFormat)}>
              <option value={5}>5-a-side</option>
              <option value={7}>7-a-side</option>
              <option value={11}>11-a-side</option>
            </select>
          </label>
        </div>
        <div className="fixture-form__row">
          <label className="field">
            <span className="field__label">Match length (minutes)</span>
            <input type="number" min={5} max={240} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
          </label>
          <label className="field">
            <span className="field__label">Periods (quarters or halves)</span>
            <input type="number" min={1} max={8} value={periods} onChange={(e) => setPeriods(Number(e.target.value))} />
          </label>
        </div>
      </div>
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
        <button type="button" className="btn btn--primary" disabled={!valid || busy} onClick={submit}>
          {fixture ? 'Save changes' : 'Add fixture'}
        </button>
      </div>
    </dialog>
  );
}
