import { createHmac, timingSafeEqual } from 'crypto';
import { config } from './config';

/**
 * Blobs are private, so nothing is fetchable by URL alone. Files reach the
 * browser through /api/files/<id>, and the CRM mints a short-lived signed link
 * when it renders a booking.
 *
 * The point of the expiry: a screenshot, a forwarded email or a URL sitting in
 * someone's browser history stops working within the hour. A public blob URL
 * never stops working, and cannot be revoked without deleting the file.
 */

const DEFAULT_TTL_SECONDS = 60 * 60; // an hour is plenty to look at a booking

function sign(documentId: string, expires: number): string {
  return createHmac('sha256', config.signingSalt)
    .update(`${documentId}.${expires}`)
    .digest('base64url');
}

export function signedFilePath(documentId: string, ttlSeconds = DEFAULT_TTL_SECONDS): string {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `/api/files/${documentId}?e=${expires}&s=${sign(documentId, expires)}`;
}

export function signedFileUrl(documentId: string, ttlSeconds = DEFAULT_TTL_SECONDS): string {
  return `${config.appUrl}${signedFilePath(documentId, ttlSeconds)}`;
}

export type VerifyResult = { ok: true } | { ok: false; reason: 'expired' | 'bad-signature' | 'malformed' };

export function verifyFileSignature(documentId: string, expiresRaw: string | null, sigRaw: string | null): VerifyResult {
  if (!expiresRaw || !sigRaw) return { ok: false, reason: 'malformed' };

  const expires = Number(expiresRaw);
  if (!Number.isFinite(expires)) return { ok: false, reason: 'malformed' };
  if (expires * 1000 < Date.now()) return { ok: false, reason: 'expired' };

  const expected = Buffer.from(sign(documentId, expires));
  const given = Buffer.from(sigRaw);
  // Length check first: timingSafeEqual throws on a mismatch.
  if (expected.length !== given.length) return { ok: false, reason: 'bad-signature' };
  if (!timingSafeEqual(expected, given)) return { ok: false, reason: 'bad-signature' };

  return { ok: true };
}
