import { buildApp } from './app';
import { loadConfig } from './config';
import { migrate } from './db/migrate';
import { createPool } from './db/pool';
import { PgRepository } from './db/repository';
import { ConsoleMailer } from './services/mailer';
import { DisabledProvider, StripeProvider } from './services/payments';

const pool = createPool();
const config = loadConfig();
await migrate(pool, (msg) => console.log(`[migrate] ${msg}`));

// Online payments switch on when a Stripe key is set (see docs/deploy.md); until then they stay off.
const payments = process.env.STRIPE_SECRET_KEY
  ? new StripeProvider(process.env.STRIPE_SECRET_KEY, process.env.STRIPE_WEBHOOK_SECRET)
  : new DisabledProvider();

const app = buildApp({ repo: new PgRepository(pool), mailer: new ConsoleMailer(), config, payments, logger: true });
const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: process.env.HOST ?? '0.0.0.0' });

// Payment-due reminders: check every six hours (each member is nudged at most every six days).
const reminders = setInterval(() => {
  app.sendPaymentReminders().catch((err) => app.log.error(err, 'payment reminders failed'));
}, 6 * 60 * 60 * 1000);
reminders.unref();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
