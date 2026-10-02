import type { Mail, Mailer } from './mailer';

export interface ResendSettings {
  apiKey: string;
  from: string;
  replyTo?: string;
}

/**
 * Email through Resend's web API. It uses a normal HTTPS request, so it works on servers whose
 * hosting blocks the mail ports (25, 465, 587), and one account serves every club.
 */
export class ResendMailer implements Mailer {
  constructor(
    private readonly settings: ResendSettings,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(mail: Mail) {
    const res = await this.fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.settings.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: this.settings.from,
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
        ...(this.settings.replyTo ? { reply_to: this.settings.replyTo } : {}),
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      throw new Error(`Email provider refused the message (${res.status}): ${body.message ?? res.statusText}`);
    }
  }
}

/** Read Resend settings from the environment; undefined means it isn't configured. */
export function resendSettingsFromEnv(env = process.env): ResendSettings | undefined {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) return undefined;
  return { apiKey: env.RESEND_API_KEY, from: env.MAIL_FROM, replyTo: env.MAIL_REPLY_TO };
}
