import { randomBytes, createHash } from 'crypto';
import { config } from './config';

/**
 * Links we text to people. They are the only credential on the signing and
 * checklist pages, so they need to be unguessable — 24 random bytes, base64url,
 * is 192 bits of entropy. No sequential ids, no booking id in the URL.
 */
export function newToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

/** Short, human-speakable booking reference. No vowels, so no accidental words. */
const REF_ALPHABET = '23456789BCDFGHJKLMNPQRSTVWXZ';

export function newReference(): string {
  const buf = randomBytes(6);
  let out = '';
  for (let i = 0; i < 6; i++) out += REF_ALPHABET[buf[i] % REF_ALPHABET.length];
  return `CHT-${out.slice(0, 3)}${out.slice(3)}`;
}

/** Draft id for uploads that arrive before the booking row exists. */
export function newDraftId(): string {
  return 'd_' + randomBytes(12).toString('base64url');
}

export function isPlausibleDraftId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 6 && v.length <= 64 && /^[A-Za-z0-9_-]+$/.test(v.replace(/^d_/, ''));
}

/**
 * Fingerprint of the exact contract wording somebody agreed to. Stored beside
 * the signature so that two years from now you can prove what they saw.
 */
export function hashTerms(text: string): string {
  return createHash('sha256').update(config.signingSalt).update(text).digest('hex');
}

export function signUrl(token: string): string {
  return `${config.appUrl}/sign/${token}`;
}

export function checklistUrl(token: string): string {
  return `${config.appUrl}/checklist/${token}`;
}
