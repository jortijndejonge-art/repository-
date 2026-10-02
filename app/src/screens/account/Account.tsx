import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Me } from '@hockey/contracts';
import { api } from '../../api-client';
import { useToast } from '../../core/Toast';
import './account.css';

const MIN_LENGTH = 10;

export function Account({ me }: { me: Me }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatch = again !== '' && next !== again;
  const valid = next.length >= MIN_LENGTH && next === again;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.changePassword(next, current || undefined);
      setCurrent('');
      setNext('');
      setAgain('');
      toast('Password saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the password');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="account">
      <h2 className="account__heading">Your account</h2>
      <p className="muted">
        {me.member.firstName} {me.member.lastName}
        {me.member.email ? ` · ${me.member.email}` : ''}
      </p>

      <form className="account__form" onSubmit={submit}>
        <h2 className="account__heading">Change password</h2>
        <label className="field">
          <span className="field__label">Current password</span>
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">New password (at least {MIN_LENGTH} characters)</span>
          <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">New password again</span>
          <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
        </label>
        {mismatch && <p className="status-bad">The two new passwords don&apos;t match.</p>}
        {error && (
          <p className="status-bad" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn--primary" disabled={!valid || busy}>
          Save password
        </button>
      </form>
    </section>
  );
}
