import { put, del, list, get } from '@vercel/blob';
import sharp from 'sharp';
import { DocKind, DocPhase } from '@prisma/client';
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

export const blobConfigured = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

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
