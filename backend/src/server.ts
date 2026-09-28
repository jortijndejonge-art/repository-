import { buildApp } from './app';
import { loadConfig } from './config';
import { migrate } from './db/migrate';
import { createPool } from './db/pool';
import { PgRepository } from './db/repository';
import { ConsoleMailer } from './services/mailer';

const pool = createPool();
const config = loadConfig();
await migrate(pool, (msg) => console.log(`[migrate] ${msg}`));

const app = buildApp({ repo: new PgRepository(pool), mailer: new ConsoleMailer(), config, logger: true });
const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: process.env.HOST ?? '0.0.0.0' });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
