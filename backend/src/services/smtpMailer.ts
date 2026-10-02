import nodemailer from 'nodemailer';
import type { Mail, Mailer } from './mailer';

export interface SmtpSettings {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
}

/** Real email over SMTP: the server's own mail service by default, or any provider. */
export class SmtpMailer implements Mailer {
  private readonly transport;

  constructor(private readonly settings: SmtpSettings) {
    const local = ['localhost', '127.0.0.1', '::1'].includes(settings.host);
    this.transport = nodemailer.createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.port === 465,
      // The server's own mail service on localhost has no certificate we could check.
      ...(local ? { ignoreTLS: true } : {}),
      ...(settings.user ? { auth: { user: settings.user, pass: settings.pass ?? '' } } : {}),
    });
  }

  async send(mail: Mail) {
    await this.transport.sendMail({ from: this.settings.from, to: mail.to, subject: mail.subject, text: mail.text });
  }
}

/** Read SMTP settings from the environment; undefined means "no real email configured". */
export function smtpSettingsFromEnv(env = process.env): SmtpSettings | undefined {
  if (!env.MAIL_FROM) return undefined;
  return {
    host: env.SMTP_HOST ?? '127.0.0.1',
    port: Number(env.SMTP_PORT ?? 25),
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.MAIL_FROM,
  };
}
