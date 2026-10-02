import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Me, Team } from '@hockey/contracts';
import { api } from '../api-client';

interface AuthState {
  me: Me | null;
  loading: boolean;
  signIn: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setLoading(false));
  }, []);

  const signIn = useCallback(async (token: string) => {
    const session = await api.verifySignIn(token);
    setMe(session.me);
  }, []);

  const signOut = useCallback(async () => {
    await api.signOut();
    setMe(null);
  }, []);

  return <AuthContext.Provider value={{ me, loading, signIn, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

/** Club admins can manage plans and every team in the club. */
export function isClubAdmin(me: Me): boolean {
  return me.memberships.some((m) => m.roles.includes('admin'));
}

/** Teams the member can manage: all club teams for admins, otherwise teams where they're manager. */
export function managedTeams(me: Me): Team[] {
  const isAdmin = me.memberships.some((m) => m.roles.includes('admin'));
  return me.teams.filter(
    (t) => isAdmin || me.memberships.some((m) => m.teamId === t.id && m.roles.includes('manager')),
  );
}

/** Teams the member plays for. */
export function playingTeams(me: Me): Team[] {
  return me.teams.filter((t) => me.memberships.some((m) => m.teamId === t.id && m.roles.includes('player')));
}

