import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const KEY_LENGTH = 64;
export const MIN_PASSWORD_LENGTH = 10;

/** "scrypt:<salt>:<hash>", both base64. A fresh random salt per password. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LENGTH);
  return `scrypt:${salt.toString('base64')}:${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  // Unknown account or no password set: still do the work, so timing doesn't reveal which.
  const [scheme, saltB64, hashB64] = (stored ?? 'scrypt:AAAAAAAAAAAAAAAAAAAAAA==:AA==').split(':');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length || KEY_LENGTH);
  return stored !== null && expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** A readable random password, e.g. for a first sign-in that the person then changes. */
export function generatePassword(): string {
  return randomBytes(12).toString('base64url');
}
