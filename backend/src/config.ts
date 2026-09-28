export interface Config {
  /** Public URL of the web app, used to build magic links. */
  appUrl: string;
  magicLinkTtlMinutes: number;
  sessionTtlDays: number;
  /**
   * Development only: include the magic link in the API response so you can
   * sign in without an email provider. Never enable in production.
   */
  exposeDevLinks: boolean;
}

export function loadConfig(env = process.env): Config {
  const production = env.NODE_ENV === 'production';
  return {
    appUrl: env.APP_URL ?? 'http://localhost:5173',
    magicLinkTtlMinutes: Number(env.MAGIC_LINK_TTL_MINUTES ?? 15),
    sessionTtlDays: Number(env.SESSION_TTL_DAYS ?? 30),
    exposeDevLinks: !production && env.EXPOSE_DEV_LINKS !== 'false',
  };
}
