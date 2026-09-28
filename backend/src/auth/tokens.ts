import { createHash, randomBytes } from 'node:crypto';

/** A URL-safe random token. Only its hash is ever stored. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
