/** Stores the access token for this browser. Storage can be unavailable (private mode), so every access is guarded. */
const KEY = 'hockey.accessToken';

export const sessionStore = {
  get(): string | null {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  set(token: string) {
    try {
      localStorage.setItem(KEY, token);
    } catch {
      /* not persisted; the session lasts until reload */
    }
  },
  clear() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  },
};
