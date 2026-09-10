import { put, del, list, get } from '@vercel/blob';
import sharp from 'sharp';
import { DocKind, DocPhase, DocumentSource } from '@prisma/client';
import { prisma } from './db';
import { config } from './config';

/**
 * Vercel Blob wrapper.
 *
 * Everything image-shaped is normalised to WebP server-side even though the
 * browser already tried — an iPhone HEIC that Chrome could not decode arrives
 * here untouched, and a 12 MB original must never reach the store.
 */

const IMAGE_TYPES = /^image\/(jpeg|png|webp|gif|avif|heic|heif|tiff|bmp)$/i;

/**
 * Vercel Blob authenticates one of two ways, and a project may use either:
 *
 *   1. OIDC — the connection sets BLOB_STORE_ID and the runtime supplies a
 *      short-lived Vercel OIDC token automatically. This is what you get if you
 *      leave "Add a read-write token env var" unticked.
 *   2. BLOB_READ_WRITE_TOKEN — the classic long-lived token, created only when
 *      that box IS ticked. This is also the one that makes `npm run dev` work
 *      locally, since OIDC tokens expire every 12 hours.
 *
 * Either is enough, so check for both. Looking only for the token would refuse
 * every upload on an OIDC-connected project that is actually working fine.
 */
export const blobConfigured = () =>
  Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);

/** Which mechanism is in play, for the settings page to report. */
export const blobAuthMode = (): 'token' | 'oidc' | 'none' =>
  process.env.BLOB_READ_WRITE_TOKEN ? 'token' : process.env.BLOB_STORE_ID ? 'oidc' : 'none';

export type StoredFile = {
  url: string;
  pathname: string;
  contentType: string;
  bytes: number;
};

export async function normaliseImage(
  input: Buffer,
  contentType: string,
): Promise<{ data: Buffer; contentType: string; ext: string }> {
  if (!IMAGE_TYPES.test(contentType)) {
    // PDFs and anything else pass through untouched.
    return { data: input, contentType: contentType || 'application/octet-stream', ext: extFor(contentType) };
  }
  try {
    const data = await sharp(input, { failOn: 'none' })
      .rotate() // honour EXIF orientation before we strip it
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    return { data, contentType: 'image/webp', ext: 'webp' };
  } catch {
    // A format sharp cannot read is still better stored than dropped.
    return { data: input, contentType, ext: extFor(contentType) };
  }
}

function extFor(contentType: string): string {
  const map: Record<string, string> = {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'image/gif': 'gif',
  };
  return map[contentType.toLowerCase()] ?? 'bin';
}

export async function storeFile(opts: {
  data: Buffer;
  contentType: string;
  ext: string;
  folder: string;
  name: string;
}): Promise<StoredFile> {
  const pathname = `${opts.folder}/${opts.name}.${opts.ext}`;
  const res = await put(pathname, opts.data, {
    // Private. These are driver's licences, insurance cards and signed
    // contracts — a public blob URL is permanent and unrevocable the moment it
    // leaks into a forwarded email or a screenshot. Everything is served back
    // through /api/files, which checks the caller first.
    access: 'private',
    contentType: opts.contentType,
    // Two uploads of the same logical name must not collide.
    addRandomSuffix: true,
  });
  return {
    url: res.url,
    pathname: res.pathname,
    contentType: opts.contentType,
    bytes: opts.data.byteLength,
  };
}

/**
 * Read a private blob back for streaming to an authorised caller.
 * Returns null when the blob is missing, so the route can 404 cleanly.
 */
export async function readBlob(pathname: string) {
  const res = await get(pathname, { access: 'private' });
  if (!res || res.statusCode !== 200 || !res.stream) return null;
  return { stream: res.stream, contentType: res.blob.contentType, size: res.blob.size };
}

export async function recordDocument(opts: {
  bookingId?: string | null;
  draftId?: string | null;
  kind: DocKind;
  phase: DocPhase;
  file: StoredFile;
  source?: DocumentSource;
  originalFilename?: string | null;
  receivedAt?: Date | null;
  uploadedBy?: string | null;
  staffNote?: string | null;
}) {
  return prisma.document.create({
    data: {
      bookingId: opts.bookingId ?? null,
      draftId: opts.draftId ?? null,
      kind: opts.kind,
      phase: opts.phase,
      url: opts.file.url,
      pathname: opts.file.pathname,
      contentType: opts.file.contentType,
      bytes: opts.file.bytes,
      source: opts.source ?? DocumentSource.RENTER,
      originalFilename: opts.originalFilename ?? null,
      receivedAt: opts.receivedAt ?? null,
      uploadedBy: opts.uploadedBy ?? null,
      staffNote: opts.staffNote ?? null,
    },
  });
}

/** Attach documents uploaded against a draft id to the booking they belong to. */
export async function adoptDraftDocuments(draftId: string, bookingId: string) {
  if (!draftId) return 0;
  const res = await prisma.document.updateMany({
    where: { draftId, bookingId: null },
    data: { bookingId },
  });
  return res.count;
}

// ---------------------------------------------------------------- retention

export type UsageReport = {
  totalBytes: number;
  quotaBytes: number;
  pct: number;
  blobCount: number;
};

/** Ask Blob what we are actually using, paging through the whole store. */
export async function measureUsage(): Promise<UsageReport> {
  let cursor: string | undefined;
  let totalBytes = 0;
  let blobCount = 0;

  do {
    const page = await list({ cursor, limit: 1000 });
    for (const b of page.blobs) {
      totalBytes += b.size;
      blobCount += 1;
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  return {
    totalBytes,
    quotaBytes: config.blob.quotaBytes,
    pct: config.blob.quotaBytes ? (totalBytes / config.blob.quotaBytes) * 100 : 0,
    blobCount,
  };
}

/**
 * Delete the oldest purge-eligible photos until usage is back under the target.
 *
 * Deliberately conservative. Signed contract PDFs are never eligible; neither
 * is anything on a booking that is still open, overdue or flagged for review.
 * Those rules live in `markPurgeEligible`, which only ever stamps a date on
 * documents belonging to a completed booking.
 */
export async function purgeToTarget(): Promise<{ deleted: number; freedBytes: number; before: UsageReport; after: UsageReport | null }> {
  const before = await measureUsage();
  if (before.pct < config.blob.purgeStartPct) {
    return { deleted: 0, freedBytes: 0, before, after: null };
  }

  const targetBytes = (config.blob.purgeTargetPct / 100) * config.blob.quotaBytes;
  let freed = 0;
  let deleted = 0;

  const candidates = await prisma.document.findMany({
    where: {
      deletedAt: null,
      purgeEligibleAt: { not: null, lte: new Date() },
      kind: { not: DocKind.SIGNED_CONTRACT },
      OR: [
        { booking: null },
        {
          booking: {
            stage: 'COMPLETED',
            overdue: false,
            needsReview: false,
          },
        },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: 2000,
    select: { id: true, pathname: true, bytes: true },
  });

  for (const doc of candidates) {
    if (before.totalBytes - freed <= targetBytes) break;
    try {
      await del(doc.pathname);
    } catch {
      // Already gone from the store — still mark it so we stop counting it.
    }
    await prisma.document.update({ where: { id: doc.id }, data: { deletedAt: new Date() } });
    freed += doc.bytes;
    deleted += 1;
  }

  return { deleted, freedBytes: freed, before, after: deleted ? await measureUsage() : before };
}

/**
 * Hard-delete uploads from bookings that were never completed.
 *
 * Someone opens the widget, uploads their driver's licence, then closes the
 * tab. The draft id only ever lived in that page's memory, so nothing will
 * ever claim those files — and they are ID documents belonging to a person who
 * is not even a customer. The quota purge would not touch them until storage
 * crossed 80%, which for two trucks could be years.
 *
 * Deletes the blob and the row together, so nothing is left stranded.
 */
export async function purgeAbandonedDrafts(olderThanDays = 7): Promise<{ deleted: number; freedBytes: number }> {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);

  const rows = await prisma.document.findMany({
    where: { bookingId: null, draftId: { not: null }, createdAt: { lte: cutoff }, deletedAt: null },
    select: { id: true, pathname: true, bytes: true },
    take: 1000,
  });

  let freedBytes = 0;
  for (const r of rows) {
    try {
      await del(r.pathname);
    } catch {
      // Already gone from the store; still drop the row.
    }
    freedBytes += r.bytes;
  }
  if (rows.length) {
    await prisma.document.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  }

  return { deleted: rows.length, freedBytes };
}

/**
 * Delete blobs that no Document row points at any more.
 *
 * The purge job above is driven off the database, which leaves a hole: Document
 * rows cascade-delete with their Booking, so removing a booking takes the rows
 * away and strands their blobs where nothing will ever look for them again.
 * This sweeps the store itself and reconciles it against the table.
 *
 * Only blobs older than a day are considered, so an upload whose row is still
 * being written can never be caught mid-flight.
 */
export async function reconcileOrphanBlobs(): Promise<{ scanned: number; deleted: number; freedBytes: number }> {
  const cutoff = Date.now() - 24 * 3600_000;
  let cursor: string | undefined;
  let scanned = 0;
  let deleted = 0;
  let freedBytes = 0;

  do {
    const page = await list({ cursor, limit: 1000 });
    const stale = page.blobs.filter((b) => new Date(b.uploadedAt).getTime() < cutoff);
    scanned += stale.length;

    if (stale.length) {
      const known = await prisma.document.findMany({
        where: { pathname: { in: stale.map((b) => b.pathname) } },
        select: { pathname: true },
      });
      const keep = new Set(known.map((d) => d.pathname));

      for (const b of stale) {
        if (keep.has(b.pathname)) continue;
        try {
          await del(b.pathname);
          deleted += 1;
          freedBytes += b.size;
        } catch {
          // Already gone, or a permission blip — try again tomorrow.
        }
      }
    }

    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  return { scanned, deleted, freedBytes };
}

/**
 * Called when a booking completes: stamp each document with the date it
 * becomes eligible for deletion. ID documents go sooner than photos, because
 * holding somebody's driver's licence longer than you need it is a liability.
 */
export async function markPurgeEligible(bookingId: string) {
  const now = Date.now();
  const idDocsAt = new Date(now + config.retention.idDocsDays * 86_400_000);
  const photosAt = new Date(now + config.retention.checklistPhotoDays * 86_400_000);

  await prisma.$transaction([
    prisma.document.updateMany({
      where: { bookingId, kind: { in: [DocKind.DRIVER_LICENSE, DocKind.INSURANCE] } },
      data: { purgeEligibleAt: idDocsAt },
    }),
    prisma.document.updateMany({
      where: { bookingId, kind: { in: [DocKind.CARGO, DocKind.EXTERIOR, DocKind.FUEL_GAUGE, DocKind.OTHER] } },
      data: { purgeEligibleAt: photosAt },
    }),
  ]);
}
