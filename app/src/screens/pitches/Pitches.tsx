import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { AgeGroup, Me, Pitch } from '@hockey/contracts';
import { clock, dayName } from '@hockey/engine';
import { api } from '../../api-client';
import { useToast } from '../../core/Toast';
import './pitches.css';

const AGE_GROUPS: AgeGroup[] = ['U8', 'U10', 'U12', 'U14', 'U16', 'U18', 'Adult'];
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
const toMinute = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** The club's pitches and when each is open to which age groups: the basis for planning fixtures without clashes. */
export function Pitches({ me }: { me: Me }) {
  const toast = useToast();
  const [pitches, setPitches] = useState<Pitch[] | null>(null);
  const [name, setName] = useState('');

  const load = useCallback(async () => setPitches(await api.getPitches(me.club.id)), [me.club.id]);
  useEffect(() => {
    load().catch(() => toast('Could not load the pitches'));
  }, [load, toast]);

  const addPitch = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const made = await api.addPitch(me.club.id, name.trim());
      setPitches((cur) => [...(cur ?? []), made]);
      setName('');
      toast(`Added ${made.name}. Now add when it is open.`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not add the pitch');
    }
  };

  const removePitch = async (pitch: Pitch) => {
    if (!window.confirm(`Delete ${pitch.name}? Matches booked on it stay, but lose their pitch.`)) return;
    try {
      await api.deletePitch(pitch.id);
      setPitches((cur) => cur?.filter((p) => p.id !== pitch.id) ?? cur);
    } catch {
      toast('Could not delete the pitch');
    }
  };

  return (
    <section className="pitches">
      <p className="muted small">
        Add each pitch, then the weekly times it is open and for which age groups. When you add a match, the app warns about
        double bookings and suggests free times.
      </p>

      <form className="pitches__add" onSubmit={addPitch}>
        <label className="field">
          <span className="field__label">New pitch</span>
          <input value={name} maxLength={80} placeholder="Main astro" onChange={(e) => setName(e.target.value)} />
        </label>
        <button type="submit" className="btn btn--primary" disabled={name.trim() === ''}>
          Add pitch
        </button>
      </form>

      {pitches === null ? (
        <p className="muted">Loading pitches…</p>
      ) : pitches.length === 0 ? (
        <p className="muted">No pitches yet. Add your first one above.</p>
      ) : (
        pitches.map((pitch) => <PitchCard key={pitch.id} pitch={pitch} onChanged={load} onDelete={() => removePitch(pitch)} />)
      )}
    </section>
  );
}

function PitchCard({ pitch, onChanged, onDelete }: { pitch: Pitch; onChanged: () => Promise<void>; onDelete: () => void }) {
  const toast = useToast();
  const [weekday, setWeekday] = useState(5);
  const [from, setFrom] = useState('09:00');
  const [to, setTo] = useState('13:00');
  const [groups, setGroups] = useState<AgeGroup[]>([]);
  const [busy, setBusy] = useState(false);

  const toggle = (g: AgeGroup) => setGroups((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]));
  const valid = groups.length > 0 && from && to && toMinute(to) > toMinute(from);

  const addSlot = async () => {
    setBusy(true);
    try {
      await api.addPitchSlot(pitch.id, { weekday, startMinute: toMinute(from), endMinute: toMinute(to), ageGroups: AGE_GROUPS.filter((g) => groups.includes(g)) });
      await onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not add that opening');
    } finally {
      setBusy(false);
    }
  };

  const removeSlot = async (id: string) => {
    try {
      await api.deletePitchSlot(id);
      await onChanged();
    } catch {
      toast('Could not remove that opening');
    }
  };

  return (
    <article className="pitches__card">
      <header className="pitches__head">
        <h2>{pitch.name}</h2>
        <button type="button" className="btn btn--ghost" onClick={onDelete}>
          Delete pitch
        </button>
      </header>

      {pitch.slots.length === 0 ? (
        <p className="muted small">No times yet. Until you add some, any time is accepted on this pitch.</p>
      ) : (
        <ul className="pitches__slots">
          {pitch.slots.map((s) => (
            <li key={s.id}>
              <strong>{dayName(s.weekday)}</strong> {clock(s.startMinute)}–{clock(s.endMinute)}
              <span className="muted small"> · {s.ageGroups.join(', ')}</span>
              <button type="button" className="pitches__remove" aria-label={`Remove ${dayName(s.weekday)} ${clock(s.startMinute)} opening`} onClick={() => removeSlot(s.id)}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="pitches__form">
        <span className="field__label">Add an opening (every week)</span>
        <div className="pitches__row">
          <label className="field">
            <span className="muted small">Day</span>
            <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
              {WEEKDAYS.map((d) => (
                <option key={d} value={d}>
                  {dayName(d)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="muted small">From</span>
            <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field">
            <span className="muted small">Until</span>
            <input type="time" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <fieldset className="pitches__groups">
          <legend className="muted small">For these age groups</legend>
          {AGE_GROUPS.map((g) => (
            <label key={g} className="pitches__group">
              <input type="checkbox" checked={groups.includes(g)} onChange={() => toggle(g)} />
              {g}
            </label>
          ))}
        </fieldset>
        <button type="button" className="btn" disabled={!valid || busy} onClick={addSlot}>
          Add opening
        </button>
      </div>
    </article>
  );
}
