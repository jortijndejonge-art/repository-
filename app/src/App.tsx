import { useCallback, useState } from 'react';
import type { Me } from '@hockey/contracts';
import { AuthProvider, managedTeams, playingTeams, useAuth } from './core/auth';
import { ToastProvider } from './core/Toast';
import { SignIn } from './screens/auth/SignIn';
import { Verify } from './screens/auth/Verify';
import { MyMatches } from './screens/availability/MyMatches';
import { LineupPlanner } from './screens/lineup/LineupPlanner';
import './core/shell.css';

export function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <Root />
      </AuthProvider>
    </ToastProvider>
  );
}

/** Where the app is served from, e.g. "/" locally or "/myhockey/" on the website. */
const BASE = import.meta.env.BASE_URL;

/** Current path relative to BASE, always starting with "/". */
const routePath = () => '/' + location.pathname.slice(BASE.length).replace(/^\/+/, '');

function Root() {
  const { me, loading } = useAuth();
  const [path, setPath] = useState(routePath);

  const goHome = useCallback(() => {
    history.replaceState(null, '', BASE);
    setPath('/');
  }, []);

  if (path === '/auth/verify') {
    return <Verify token={new URLSearchParams(location.search).get('token')} onDone={goHome} />;
  }
  if (loading) return <div className="loading">Loading…</div>;
  if (!me) return <SignIn />;
  return <Shell me={me} />;
}

type Tab = 'matches' | 'lineup';

function Shell({ me }: { me: Me }) {
  const { signOut } = useAuth();
  const canManage = managedTeams(me).length > 0;
  const plays = playingTeams(me).length > 0;
  const [tab, setTab] = useState<Tab>(canManage ? 'lineup' : 'matches');
  const tabs: { id: Tab; label: string }[] = [
    ...(plays ? [{ id: 'matches' as const, label: 'My matches' }] : []),
    ...(canManage ? [{ id: 'lineup' as const, label: 'Lineup planner' }] : []),
  ];

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__logo" aria-hidden="true" />
          <div>
            <div className="topbar__club">{me.club.name}</div>
            <h1 className="topbar__title">{tabs.find((t) => t.id === tab)?.label ?? 'Home'}</h1>
          </div>
        </div>
        <div className="topbar__user">
          <span className="muted small">{me.member.firstName}</span>
          <button type="button" className="btn btn--ghost" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      {tabs.length > 1 && (
        <nav className="tabs" aria-label="Sections">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className={t.id === tab ? 'is-active' : undefined}
              aria-current={t.id === tab ? 'page' : undefined}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      )}

      {tab === 'lineup' && canManage && <LineupPlanner me={me} />}
      {tab === 'matches' && <MyMatches me={me} />}
      {tabs.length === 0 && <p className="muted">You're not in any teams yet — ask your club to add you.</p>}
    </div>
  );
}
