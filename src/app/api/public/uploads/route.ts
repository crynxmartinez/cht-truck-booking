import { DocKind, DocPhase } from '@prisma/client';
import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { json, preflight, clientIp, rateLimit } from '@/lib/http';
import { isPlausibleDraftId } from '@/lib/tokens';
import { blobConfigured, normaliseImage, recordDocument, storeFile } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function OPTIONS(req: Request) {
  return preflight(req.headers.get('origin'));
}

const BOOKING_KINDS: Record<string, DocKind> = {
  DRIVER_LICENSE: DocKind.DRIVER_LICENSE,
  INSURANCE: DocKind.INSURANCE,
};

/**
 * POST /api/public/uploads   (multipart: file, kind, draftId)
 *
 * Uploads arrive before the booking exists, so they are parked against the
 * draft id and adopted when the booking is created. Anything orphaned is
 * cleaned up by the nightly sweep.
 */
export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  const ip = clientIp(req);

  const limit = rateLimit(`upload:${ip}`, 20, 10 * 60_000);
  if (!limit.ok) {
    return json({ error: 'Too many uploads. Please wait a few minutes.' }, { status: 429, origin });
  }

  if (!blobConfigured()) {
    return json(
      { error: 'File storage is not connected yet. Please call us and we will take your details.' },
      { status: 503, origin },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: 'Could not read that upload.' }, { status: 400, origin });
  }

  const file = form.get('file');
  const kindRaw = String(form.get('kind') ?? '');
  const draftId = String(form.get('draftId') ?? '');

  if (!(file instanceof File)) return json({ error: 'No file received.' }, { status: 400, origin });
  if (!isPlausibleDraftId(draftId)) return json({ error: 'Missing upload session.' }, { status: 400, origin });

  const kind = BOOKING_KINDS[kindRaw];
  if (!kind) return json({ error: 'Unknown document type.' }, { status: 400, origin });

  if (file.size > config.maxUploadBytes) {
    return json(
      { error: `That file is over ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB. Try a photo rather than a scan.` },
      { status: 413, origin },
    );
  }

  // One of each kind per draft — re-uploading replaces rather than piles up.
  const existing = await prisma.document.count({ where: { draftId } });
  if (existing > 12) {
    return json({ error: 'Too many files on this booking.' }, { status: 429, origin });
  }

  try {
    const raw = Buffer.from(await file.arrayBuffer());
    const norm = await normaliseImage(raw, file.type || 'application/octet-stream');

    const stored = await storeFile({
      data: norm.data,
      contentType: norm.contentType,
      ext: norm.ext,
      folder: `bookings/drafts/${draftId}`,
      name: kindRaw.toLowerCase(),
    });

    const doc = await recordDocument({
      draftId,
      kind,
      phase: DocPhase.BOOKING,
      file: stored,
    });

    return json({ id: doc.id, bytes: stored.bytes, contentType: stored.contentType }, { origin });
  } catch (err) {
    console.error('upload failed', err);
    return json({ error: 'Upload failed. Please try again.' }, { status: 500, origin });
  }
}
