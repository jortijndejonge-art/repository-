import { useState } from 'react';
import type { FormEvent } from 'react';
import * as demo from '@hockey/demo';
import { api } from '../../api-client';
import { useAuth } from '../../core/auth';
import './auth.css';

const demoPlayer = demo.members.find((m) => m.id === 'u12-p4')!;

export function SignIn() {
  const { signIn, signInWithPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [usePassword, setUsePassword] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [devLink, setDevLink] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setState('sending');
    try {
      const res = await api.requestSignIn(email);
      setDevLink(res.devLink ?? null);
      setState('sent');
    } catch {
      setState('error');
    }
  };

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    setState('sending');
    setLoginError(null);
    try {
      await signInWithPassword(email, password);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Could not sign in');
      setState('idle');
    }
  };

  const demoSignIn = (memberId: string) => signIn(`mock:${memberId}`);

  return (
    <main className="auth">
      <div className="auth__card">
        <span className="auth__logo" aria-hidden="true" />
        <h1>Sign in</h1>
        {state === 'sent' ? (
          <>
            <p>
              If <strong>{email}</strong> belongs to a club member, a sign-in link is on its way. Tap it on this device
              — no password needed.
            </p>
            {devLink && (
              <p className="auth__dev">
                Development: <a href={devLink}>open the sign-in link</a>
              </p>
            )}
            <button type="button" className="btn btn--ghost" onClick={() => setState('idle')}>
              Use a different email
            </button>
          </>
        ) : usePassword ? (
          <form onSubmit={submitPassword} className="auth__form">
            <label className="field">
              <span className="field__label">Email</span>
              <input
                type="email"
                required
                autoComplete="username"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </label>
            <label className="field">
              <span className="field__label">Password</span>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button type="submit" className="btn btn--primary" disabled={state === 'sending'}>
              {state === 'sending' ? 'Signing in…' : 'Sign in'}
            </button>
            {loginError && (
              <p className="status-bad" role="alert">
                {loginError}
              </p>
            )}
            <button type="button" className="btn btn--ghost" onClick={() => setUsePassword(false)}>
              Email me a link instead
            </button>
          </form>
        ) : (
          <form onSubmit={submit} className="auth__form">
            <p className="muted">Enter the email your club has for you and we'll send you a one-tap sign-in link.</p>
            <label className="field">
              <span className="field__label">Email</span>
              <input
                type="email"
                required
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </label>
            <button type="submit" className="btn btn--primary" disabled={state === 'sending'}>
              {state === 'sending' ? 'Sending…' : 'Email me a link'}
            </button>
            {state === 'error' && <p className="status-bad">Couldn't send the link. Please try again.</p>}
            <button type="button" className="btn btn--ghost" onClick={() => setUsePassword(true)}>
              Sign in with a password instead
            </button>
          </form>
        )}

        {api.mode === 'mock' && (
          <div className="auth__demo">
            <span className="field__label">Demo mode — no server</span>
            <div className="auth__demo-buttons">
              <button type="button" className="btn" onClick={() => demoSignIn(demo.coach.id)}>
                Sign in as the coach
              </button>
              <button type="button" className="btn" onClick={() => demoSignIn(demoPlayer.id)}>
                Sign in as a player ({demoPlayer.firstName})
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
