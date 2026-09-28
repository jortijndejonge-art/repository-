import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../core/auth';
import './auth.css';

/** Landing page for magic links: /auth/verify?token=… */
export function Verify({ token, onDone }: { token: string | null; onDone: () => void }) {
  const { signIn } = useAuth();
  const [error, setError] = useState<string | null>(token ? null : 'This link is missing its token.');
  const started = useRef(false);

  useEffect(() => {
    // Links are single-use, so guard against React running the effect twice.
    if (!token || started.current) return;
    started.current = true;
    signIn(token)
      .then(onDone)
      .catch(() => setError('This link has expired or has already been used.'));
  }, [token, signIn, onDone]);

  return (
    <main className="auth">
      <div className="auth__card">
        <span className="auth__logo" aria-hidden="true" />
        {error ? (
          <>
            <h1>Link didn't work</h1>
            <p>{error}</p>
            <button type="button" className="btn btn--primary" onClick={onDone}>
              Get a new link
            </button>
          </>
        ) : (
          <h1>Signing you in…</h1>
        )}
      </div>
    </main>
  );
}
