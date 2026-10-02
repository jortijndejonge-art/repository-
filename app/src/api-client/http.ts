import type { AuthSession } from '@hockey/contracts';
import { sessionStore } from './session';
import { ApiError, type ApiClient } from './types';

/**
 * Talks to the real backend (see /backend). Requests go to <app base>/api/v1 —
 * proxied by Vite in development, and by the web server in production.
 */
export function createHttpClient(baseUrl = `${import.meta.env.BASE_URL}api/v1`): ApiClient {
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
    async signInWithPassword(email, password) {
      const session = await request<AuthSession>('POST', '/auth/login', { email, password });
      token = session.accessToken;
      sessionStore.set(token);
      return session;
    },
    changePassword: (newPassword, currentPassword) =>
      request('PUT', '/me/password', { newPassword, ...(currentPassword ? { currentPassword } : {}) }),
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
    addPlayer: (teamId, player) => request('POST', `/teams/${enc(teamId)}/players`, player),
    createPlayerLogin: (teamId, memberId, email) =>
      request('POST', `/teams/${enc(teamId)}/players/${enc(memberId)}/login`, email ? { email } : undefined),
    updatePlayer: (teamId, memberId, update) =>
      request('PATCH', `/teams/${enc(teamId)}/players/${enc(memberId)}`, update),
    getPaymentsConfig: () => request('GET', '/payments/config'),
    getMembershipPlans: (clubId) => request('GET', `/clubs/${enc(clubId)}/membership-plans`),
    createMembershipPlan: (clubId, plan) => request('POST', `/clubs/${enc(clubId)}/membership-plans`, plan),
    getMyMemberships: () => request('GET', '/me/memberships'),
    startCheckout: (planId) => request('POST', `/membership-plans/${enc(planId)}/checkout`),
    getFixtures: (teamId, from) =>
      request('GET', `/teams/${enc(teamId)}/fixtures${from ? `?from=${enc(from)}` : ''}`),
    addFixture: (teamId, fixture) => request('POST', `/teams/${enc(teamId)}/fixtures`, fixture),
    updateFixture: (fixtureId, update) => request('PATCH', `/fixtures/${enc(fixtureId)}`, update),
    deleteFixture: (fixtureId) => request('DELETE', `/fixtures/${enc(fixtureId)}`),
    getGuardians: (teamId, childId) => request('GET', `/teams/${enc(teamId)}/players/${enc(childId)}/guardians`),
    addGuardian: (teamId, childId, guardian) =>
      request('POST', `/teams/${enc(teamId)}/players/${enc(childId)}/guardians`, guardian),
    getAnnouncements: (teamId) => request('GET', `/teams/${enc(teamId)}/announcements`),
    postAnnouncement: (teamId, announcement) => request('POST', `/teams/${enc(teamId)}/announcements`, announcement),
    deleteAnnouncement: (announcementId) => request('DELETE', `/announcements/${enc(announcementId)}`),
    getTrainingSessions: (teamId, from) =>
      request('GET', `/teams/${enc(teamId)}/training${from ? `?from=${enc(from)}` : ''}`),
    addTrainingSession: (teamId, session) => request('POST', `/teams/${enc(teamId)}/training`, session),
    updateTrainingSession: (sessionId, update) => request('PATCH', `/training/${enc(sessionId)}`, update),
    deleteTrainingSession: (sessionId) => request('DELETE', `/training/${enc(sessionId)}`),
    getTrainingResponses: (sessionId) => request('GET', `/training/${enc(sessionId)}/responses`),
    setTrainingRsvp: (sessionId, memberId, status) =>
      request('PUT', `/training/${enc(sessionId)}/rsvp`, { memberId, status }),
    setTrainingAttendance: (sessionId, memberId, attended) =>
      request('PUT', `/training/${enc(sessionId)}/attendance`, { memberId, attended }),
    getAvailability: (fixtureId) => request('GET', `/fixtures/${enc(fixtureId)}/availability`),
    setAvailability: (fixtureId, memberId, status) =>
      request('PUT', `/fixtures/${enc(fixtureId)}/availability`, { memberId, status }),
    getFormations: (format) => request('GET', `/formations?format=${format}`),
    getCustomFormations: (teamId, format) =>
      request('GET', `/teams/${enc(teamId)}/formations${format ? `?format=${format}` : ''}`),
    createCustomFormation: (teamId, input) => request('POST', `/teams/${enc(teamId)}/formations`, input),
    getFormationLayouts: (teamId) => request('GET', `/teams/${enc(teamId)}/formation-layouts`),
    saveFormationLayout: (teamId, { formationId, positions }) =>
      request('PUT', `/teams/${enc(teamId)}/formation-layouts/${enc(formationId)}`, { positions }),
    resetFormationLayout: (teamId, formationId) =>
      request('DELETE', `/teams/${enc(teamId)}/formation-layouts/${enc(formationId)}`),
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
