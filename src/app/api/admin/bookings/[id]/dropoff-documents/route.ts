import { DocKind, DocPhase, DocumentSource, Stage } from '@prisma/client';
import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { cleanString, clientIp, json, rateLimit } from '@/lib/http';
import { blobConfigured, normaliseImage, recordDocument, storeFile } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const STAFF_KINDS = new Set<DocKind>([
  DocKind.CARGO,
  DocKind.EXTERIOR,
  DocKind.FUEL_GAUGE,
  DocKind.OTHER,
]);
const STAFF_SOURCES = new Set<DocumentSource>([
  DocumentSource.STAFF_EMAIL,
  DocumentSource.STAFF_SMS,
  DocumentSource.STAFF_OTHER,
]);

/** One return photo at a time; the CRM sends several requests sequentially. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: bookingId } = await params;
  const limit = rateLimit(`staff-dropoff-upload:${clientIp(req)}`, 80, 10 * 60_000);
  if (!limit.ok) return json({ error: 'Too many uploads. Wait a moment and try again.' }, { status: 429 });

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      reference: true,
      stage: true,
      checklists: { where: { phase: 'DROPOFF' }, select: { id: true } },
    },
  });
  if (!booking) return json({ error: 'Reservation not found.' }, { status: 404 });
  if (booking.stage === Stage.CANCELLED) return json({ error: 'This reservation is cancelled.' }, { status: 409 });
  if (!booking.checklists.length) return json({ error: 'This reservation has no drop-off checklist.' }, { status: 409 });
  if (!blobConfigured()) return json({ error: 'Photo storage is not connected.' }, { status: 503 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: 'Could not read that upload.' }, { status: 400 });
  }

  const file = form.get('file');
  const kind = cleanString(form.get('kind'), 30).toUpperCase() as DocKind;
  const source = cleanString(form.get('source'), 30).toUpperCase() as DocumentSource;
  const uploadedBy = cleanString(form.get('uploadedBy'), 120) || 'Diana Alsup';
  const staffNote = cleanString(form.get('staffNote'), 2000) || null;
  const receivedRaw = cleanString(form.get('receivedAt'), 30);
  const receivedAt = receivedRaw ? new Date(`${receivedRaw}T12:00:00.000Z`) : new Date();

  if (!(file instanceof File)) return json({ error: 'Choose a photo first.' }, { status: 400 });
  if (!STAFF_KINDS.has(kind)) return json({ error: 'Choose a valid photo category.' }, { status: 400 });
  if (!STAFF_SOURCES.has(source)) return json({ error: 'Choose where the photo came from.' }, { status: 400 });
  if (Number.isNaN(receivedAt.getTime())) return json({ error: 'Choose a valid received date.' }, { status: 400 });
  if (file.size > config.maxUploadBytes) {
    return json({ error: `That file is over ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB.` }, { status: 413 });
  }

  const count = await prisma.document.count({ where: { bookingId, phase: DocPhase.DROPOFF, deletedAt: null } });
  if (count >= 60) return json({ error: 'This reservation already has a large number of return photos.' }, { status: 429 });

  try {
    const normal = await normaliseImage(
      Buffer.from(await file.arrayBuffer()),
      file.type || 'application/octet-stream',
    );
    const stored = await storeFile({
      data: normal.data,
      contentType: normal.contentType,
      ext: normal.ext,
      folder: `bookings/${booking.reference}/dropoff/staff`,
      name: kind.toLowerCase(),
    });
    const document = await recordDocument({
      bookingId,
      kind,
      phase: DocPhase.DROPOFF,
      file: stored,
      source,
      originalFilename: file.name.slice(0, 255),
      receivedAt,
      uploadedBy,
      staffNote,
    });

    return json({ id: document.id, bytes: document.bytes, contentType: document.contentType });
  } catch (err) {
    console.error('staff drop-off upload failed', { bookingId, err });
    return json({ error: 'That photo could not be saved. Please try again.' }, { status: 500 });
  }
}
