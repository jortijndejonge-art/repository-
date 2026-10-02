import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config';
import { AuthService } from '../services/auth';
import { ConsoleMailer } from '../services/mailer';
import { createPool } from './pool';
import { PgRepository } from './repository';

/**
 * Set a member's password from the server: `--email you@example.com [--password "…"]`.
 * Without --password a random one is generated and printed once.
 */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const get = (flag: string) => argv[argv.indexOf(flag) + 1];
  const email = argv.includes('--email') ? get('--email') : undefined;
  const pool = createPool();
  (async () => {
    if (!email) throw new Error('Usage: --email you@example.com [--password "…"]');
    const auth = new AuthService(new PgRepository(pool), new ConsoleMailer(), loadConfig());
    const password = await auth.setPasswordForEmail(email, argv.includes('--password') ? get('--password') : undefined);
    console.log(`Password set for ${email}: ${password}`);
  })()
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
