import { useEffect, useRef, useState } from 'react';
import type { NewPlayer, PlayerProfile, PositionLine } from '@hockey/contracts';

const LINES: { id: PositionLine; label: string }[] = [
  { id: 'GK', label: 'Goalkeeper' },
  { id: 'DEF', label: 'Defence' },
  { id: 'MID', label: 'Midfield' },
  { id: 'FWD', label: 'Forward' },
];

interface PlayerDialogProps {
  /** Present when editing; absent when adding a new player. */
  player?: PlayerProfile;
  onCancel: () => void;
  onSave: (player: NewPlayer) => Promise<void>;
}

export function PlayerDialog({ player, onCancel, onSave }: PlayerDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState(player?.displayName ?? '');
  const [shirt, setShirt] = useState(player?.shirtNumber?.toString() ?? '');
  const [positions, setPositions] = useState<PositionLine[]>(player?.positions ?? []);
  const [skill, setSkill] = useState(player?.skill ?? 5);
  const [stamina, setStamina] = useState(player?.stamina ?? 5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = Boolean(player);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  /** Order matters: the first line ticked is the player's preferred one. */
  const toggle = (line: PositionLine) =>
    setPositions((cur) => (cur.includes(line) ? cur.filter((l) => l !== line) : [...cur, line]));

  const hasName = editing ? displayName.trim().length > 0 : firstName.trim() !== '' && lastName.trim() !== '';
  const valid = positions.length > 0 && hasName;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim() || undefined,
        displayName: displayName.trim() || undefined,
        shirtNumber: shirt.trim() === '' ? undefined : Number(shirt),
        positions,
        skill,
        stamina,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the player');
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className="dialog" onCancel={onCancel} aria-labelledby="player-title">
      <h2 id="player-title">{editing ? `Edit ${player!.displayName}` : 'Add player'}</h2>
      <div className="squad-form">
        {editing ? (
          <label className="field">
            <span className="field__label">Name on lineup</span>
            <input value={displayName} maxLength={40} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
        ) : (
          <>
            <label className="field">
              <span className="field__label">First name</span>
              <input value={firstName} maxLength={80} onChange={(e) => setFirstName(e.target.value)} />
            </label>
            <label className="field">
              <span className="field__label">Last name</span>
              <input value={lastName} maxLength={80} onChange={(e) => setLastName(e.target.value)} />
            </label>
            <label className="field">
              <span className="field__label">Email (for the sign-in link)</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
          </>
        )}
        <label className="field">
          <span className="field__label">Shirt number</span>
          <input type="number" min={0} max={999} value={shirt} onChange={(e) => setShirt(e.target.value)} />
        </label>
        <fieldset className="squad-form__lines">
          <legend className="field__label">Positions (tick the preferred one first)</legend>
          {LINES.map((l) => (
            <label key={l.id}>
              <input type="checkbox" checked={positions.includes(l.id)} onChange={() => toggle(l.id)} />
              {l.label}
              {positions[0] === l.id && <span className="muted small"> · preferred</span>}
            </label>
          ))}
        </fieldset>
        <label className="field">
          <span className="field__label">Skill: {skill} / 10</span>
          <input type="range" min={1} max={10} value={skill} onChange={(e) => setSkill(Number(e.target.value))} />
        </label>
        <label className="field">
          <span className="field__label">Stamina: {stamina} / 10</span>
          <input type="range" min={1} max={10} value={stamina} onChange={(e) => setStamina(Number(e.target.value))} />
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
          {editing ? 'Save changes' : 'Add player'}
        </button>
      </div>
    </dialog>
  );
}
