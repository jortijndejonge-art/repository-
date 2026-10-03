import { buildApp } from './app';
import { loadConfig } from './config';
import { migrate } from './db/migrate';
import { createPool } from './db/pool';
import { PgRepository } from './db/repository';
import { ConsoleMailer } from './services/mailer';
import { ResendMailer, resendSettingsFromEnv } from './services/httpMailer';
import { SmtpMailer, smtpSettingsFromEnv } from './services/smtpMailer';
import { DisabledProvider, StripeProvider } from './services/payments';

const pool = createPool();
const config = loadConfig();
await migrate(pool, (msg) => console.log(`[migrate] ${msg}`));

// Online payments switch on when a Stripe key is set (see docs/deploy.md); until then they stay off.
const payments = process.env.STRIPE_SECRET_KEY
  ? new StripeProvider(process.env.STRIPE_SECRET_KEY, process.env.STRIPE_WEBHOOK_SECRET)
  : new DisabledProvider();

// Real email: Resend's web API if RESEND_API_KEY is set, else SMTP if SMTP settings are set (see deploy.md);
// otherwise messages are only printed to the log.
const resend = resendSettingsFromEnv();
const smtp = smtpSettingsFromEnv();
const mailer = resend ? new ResendMailer(resend) : smtp ? new SmtpMailer(smtp) : new ConsoleMailer();
if (!resend && !smtp && process.env.NODE_ENV === 'production') {
  console.warn('[mail] No email provider is configured: emails will only be printed here, not sent.');
}

const app = buildApp({ repo: new PgRepository(pool), mailer, emailEnabled: Boolean(resend || smtp), config, payments, logger: true });
const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: process.env.HOST ?? '0.0.0.0' });

// Payment-due reminders: check every six hours (each member is nudged at most every six days).
const reminders = setInterval(() => {
  app.sendPaymentReminders().catch((err) => app.log.error(err, 'payment reminders failed'));
}, 6 * 60 * 60 * 1000);
reminders.unref();

// Availability chasing: every three hours, remind anyone who has not said whether they can play a match in the
// next three days (each match at most once a day). The reminder is posted in the match chat.
const chasing = setInterval(() => {
  app.chaseAvailability().catch((err) => app.log.error(err, 'availability chasing failed'));
}, 3 * 60 * 60 * 1000);
chasing.unref();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
