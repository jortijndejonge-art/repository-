import type { AuthSession } from '@hockey/contracts';
import { sessionStore } from './session';
import { ApiError, type ApiClient } from './types';

/** Talks to the real backend (see /backend). Requests go to /api/v1, proxied by Vite in development. */
export function createHttpClient(baseUrl = '/api/v1'): ApiClient {
  let token = sessionStore.get();

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(baseUrl + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 204) return undefined as T;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && path !== '/auth/magic-link/verify') {
        token = null;
        sessionStore.clear();
      }
      throw new ApiError(res.status, (data as { error?: string }).error ?? res.statusText);
    }
    return data as T;
  }

  const enc = encodeURIComponent;

  return {
    mode: 'http',
    requestSignIn: (email) => request('POST', '/auth/magic-link', { email }),
    async verifySignIn(t) {
      const session = await request<AuthSession>('POST', '/auth/magic-link/verify', { token: t });
      token = session.accessToken;
      sessionStore.set(token);
      return session;
    },
    async signOut() {
      try {
        if (token) await request('POST', '/auth/logout');
      } finally {
        token = null;
        sessionStore.clear();
      }
    },
    async me() {
      if (!token) throw new ApiError(401, 'Sign in required');
      return request('GET', '/me');
    },
    getSquad: (teamId) => request('GET', `/teams/${enc(teamId)}/players`),
    getFixtures: (teamId, from) =>
      request('GET', `/teams/${enc(teamId)}/fixtures${from ? `?from=${enc(from)}` : ''}`),
    getAvailability: (fixtureId) => request('GET', `/fixtures/${enc(fixtureId)}/availability`),
    setAvailability: (fixtureId, memberId, status) =>
      request('PUT', `/fixtures/${enc(fixtureId)}/availability`, { memberId, status }),
    getFormations: (format) => request('GET', `/formations?format=${format}`),
    suggest: ({ fixtureId, ...rest }) => request('POST', `/fixtures/${enc(fixtureId)}/lineup/suggest`, rest),
    async getLineup(fixtureId) {
      try {
        return await request('GET', `/fixtures/${enc(fixtureId)}/lineup`);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    saveLineup: (fixtureId, lineup) => request('PUT', `/fixtures/${enc(fixtureId)}/lineup`, lineup),
    shareLineup: (fixtureId, memberIds) => request('POST', `/fixtures/${enc(fixtureId)}/lineup/share`, { memberIds }),
  };
}
