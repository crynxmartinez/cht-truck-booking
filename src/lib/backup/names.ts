/**
 * Names for the backup folder on a Windows PC. Renter names are typed by the
 * public, so anything can arrive: slashes, trailing dots, device names like
 * CON. Every name here is made safe, and if nothing usable is left the
 * booking reference alone is used.
 */

const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/** One path segment, safe on Windows and short enough to stay under path limits. */
export function safeSegment(input: string, max = 48): string {
  let s = input
    .normalize('NFC')
    .replace(ILLEGAL, ' ')
    .replace(/[​-‏‪-‮⁦-⁩﻿]/g, '') // invisible direction tricks
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > max) s = s.slice(0, max).trim();
  // Windows silently drops trailing dots and spaces, which would make two names collide.
  s = s.replace(/[. ]+$/g, '').replace(/^[. ]+/, '');
  if (RESERVED.test(s)) s = `_${s}`;
  return s;
}

/** `CHT-AB12CD - Renter Name - 2026-11-20`, or just the reference and date if the name is unusable. */
export function bookingFolderName(reference: string, renterName: string, pickupIso: string): string {
  const ref = safeSegment(reference, 20) || 'booking';
  const name = safeSegment(renterName, 40);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(pickupIso) ? pickupIso : '';
  return [ref, name, date].filter(Boolean).join(' - ');
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
};

/** `driver_license-booking-1a2b3c4d.webp`: made from our own fields, never from a filename a stranger chose. */
export function documentFileName(doc: { id: string; kind: string; phase: string; contentType: string }): string {
  const ext = EXT[doc.contentType.toLowerCase()] ?? 'bin';
  const short = doc.id.replace(/[^a-z0-9]/gi, '').slice(-8) || 'file';
  return `${doc.kind.toLowerCase()}-${doc.phase.toLowerCase()}-${short}.${ext}`;
}
