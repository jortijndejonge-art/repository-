import { useEffect, useRef, useState } from 'react';
import type { NewTrainingSession, TrainingSession } from '@hockey/contracts';

interface TrainingDialogProps {
  /** Present when editing. */
  session?: TrainingSession;
  onCancel: () => void;
  onSave: (session: NewTrainingSession) => Promise<void>;
}

/** An ISO time as the "YYYY-MM-DDTHH:mm" text a datetime-local input wants, in the browser's time zone. */
function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function TrainingDialog({ session, onCancel, onSave }: TrainingDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [startsAt, setStartsAt] = useState(session ? toLocalInput(session.startsAt) : '');
  const [minutes, setMinutes] = useState(session?.durationMinutes ?? 60);
  const [venue, setVenue] = useState(session?.venue ?? '');
  const [notes, setNotes] = useState(session?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const valid = startsAt !== '' && venue.trim() !== '' && minutes >= 5;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave({
        startsAt: new Date(startsAt).toISOString(),
        durationMinutes: minutes,
        venue: venue.trim(),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the session');
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className="dialog" onCancel={onCancel} aria-labelledby="training-title">
      <h2 id="training-title">{session ? 'Edit training' : 'Add training'}</h2>
      <div className="fixture-form">
        <label className="field">
          <span className="field__label">Date and time</span>
          <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </label>
        <div className="fixture-form__row">
          <label className="field">
            <span className="field__label">Length (minutes)</span>
            <input type="number" min={5} max={300} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
          </label>
          <label className="field">
            <span className="field__label">Venue</span>
            <input value={venue} maxLength={160} onChange={(e) => setVenue(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span className="field__label">Notes for the squad (optional)</span>
          <textarea rows={3} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
        </label>
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
          {session ? 'Save changes' : 'Add training'}
        </button>
      </div>
    </dialog>
  );
}
