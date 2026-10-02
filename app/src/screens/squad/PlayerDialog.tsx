import { useEffect, useRef, useState } from 'react';
import type { GuardianSummary, NewGuardian, NewPlayer, PlayerProfile, PositionLine } from '@hockey/contracts';

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
  /** Editing only: create a sign-in for this player; resolves with the details to hand over. */
  onCreateLogin?: (email?: string) => Promise<{ email: string; password: string }>;
  /** Editing only: this player's parents/guardians, and linking another one. */
  onLoadGuardians?: () => Promise<GuardianSummary[]>;
  onAddGuardian?: (guardian: NewGuardian) => Promise<{ guardian: GuardianSummary; password?: string }>;
}

export function PlayerDialog({ player, onCancel, onSave, onCreateLogin, onLoadGuardians, onAddGuardian }: PlayerDialogProps) {
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
  const [guardians, setGuardians] = useState<GuardianSummary[] | null>(null);
  const [gFirst, setGFirst] = useState('');
  const [gLast, setGLast] = useState('');
  const [gEmail, setGEmail] = useState('');
  const [gResult, setGResult] = useState<{ email: string; password?: string } | null>(null);
  const [gError, setGError] = useState<string | null>(null);
  const [loginEmail, setLoginEmail] = useState('');
  const [login, setLogin] = useState<{ email: string; password: string } | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const createLogin = async () => {
    setLoginError(null);
    setCopied(false);
    try {
      setLogin(await onCreateLogin!(loginEmail.trim() || undefined));
    } catch (e) {
      setLogin(null);
      setLoginError(e instanceof Error ? e.message : 'Could not create the sign-in');
    }
  };

  const copyLogin = async () => {
    if (!login) return;
    try {
      await navigator.clipboard.writeText(`Email: ${login.email}
Password: ${login.password}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  useEffect(() => {
    onLoadGuardians?.()
      .then(setGuardians)
      .catch(() => setGuardians([]));
    // Loaded once, when the dialog opens for this player.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addGuardian = async () => {
    setGError(null);
    setGResult(null);
    try {
      const res = await onAddGuardian!({ firstName: gFirst.trim(), lastName: gLast.trim(), email: gEmail.trim() });
      setGuardians((cur) => (cur?.some((g) => g.memberId === res.guardian.memberId) ? cur : [...(cur ?? []), res.guardian]));
      setGResult({ email: res.guardian.email ?? gEmail.trim(), password: res.password });
      setGFirst('');
      setGLast('');
      setGEmail('');
    } catch (e) {
      setGError(e instanceof Error ? e.message : 'Could not add the parent');
    }
  };

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
      {editing && onCreateLogin && (
        <div className="squad-login">
          <span className="field__label">Sign-in</span>
          <label className="field">
            <span className="muted small">Email (only needed if they don&apos;t have one yet)</span>
            <input type="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} />
          </label>
          <button type="button" className="btn" onClick={createLogin}>
            Create sign-in password
          </button>
          {login && (
            <div className="squad-login__result" role="status">
              <div>Email: <strong>{login.email}</strong></div>
              <div>Password: <strong>{login.password}</strong></div>
              <p className="muted small">Shown once. Give it to {player!.displayName}; they can change it in Account.</p>
              <button type="button" className="btn btn--ghost" onClick={copyLogin}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          )}
          {loginError && (
            <p className="squad-error" role="alert">
              {loginError}
            </p>
          )}
        </div>
      )}
      {editing && onAddGuardian && (
        <div className="squad-login">
          <span className="field__label">Parents and guardians</span>
          {guardians && guardians.length > 0 ? (
            <ul className="squad-guardians">
              {guardians.map((g) => (
                <li key={g.memberId}>
                  {g.firstName} {g.lastName}
                  {g.email ? <span className="muted small"> · {g.email}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <span className="muted small">{guardians ? 'None linked yet.' : 'Loading…'}</span>
          )}
          <div className="fixture-form__row">
            <label className="field">
              <span className="muted small">First name</span>
              <input value={gFirst} maxLength={80} onChange={(e) => setGFirst(e.target.value)} />
            </label>
            <label className="field">
              <span className="muted small">Last name</span>
              <input value={gLast} maxLength={80} onChange={(e) => setGLast(e.target.value)} />
            </label>
          </div>
          <label className="field">
            <span className="muted small">Email (an existing parent is found by their email)</span>
            <input type="email" value={gEmail} onChange={(e) => setGEmail(e.target.value)} />
          </label>
          <button
            type="button"
            className="btn"
            disabled={gFirst.trim() === '' || gLast.trim() === '' || !gEmail.includes('@')}
            onClick={addGuardian}
          >
            Link parent
          </button>
          {gResult && (
            <div className="squad-login__result" role="status">
              <div>
                Linked <strong>{gResult.email}</strong>
              </div>
              {gResult.password ? (
                <>
                  <div>
                    First password: <strong>{gResult.password}</strong>
                  </div>
                  <p className="muted small">Shown once. They can change it in Account.</p>
                </>
              ) : (
                <p className="muted small">They already have a sign-in, so their password is unchanged.</p>
              )}
            </div>
          )}
          {gError && (
            <p className="squad-error" role="alert">
              {gError}
            </p>
          )}
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
        <button type="button" className="btn btn--primary" disabled={!valid || busy} onClick={submit}>
          {editing ? 'Save changes' : 'Add player'}
        </button>
      </div>
    </dialog>
  );
}
