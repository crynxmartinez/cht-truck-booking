import sharp from 'sharp';
import { prisma } from '@/lib/db';
import { clientIp, json, rateLimit } from '@/lib/http';
import { loadSettings } from '@/lib/settings';
import { readBlob } from '@/lib/storage';
import { buildRecord, type BookingSource } from '@/lib/backup/record';
import { renderRecordPdf, type RecordPhoto } from '@/lib/backup/record-pdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Truck photos worth showing in a PDF someone will forward; more than this and it becomes a slow, heavy file. */
const MAX_PHOTOS = 8;
const TRUCK_PHOTO_KINDS = new Set(['CARGO', 'EXTERIOR', 'FUEL_GAUGE']);

/**
 * GET /api/admin/bookings/:id/record
 *
 * A PDF copy of one booking: details, signing record, checklists, messages and
 * the truck photos. Licence and insurance photos are listed but never shown, and
 * lockbox codes are hidden, so the file is safe to forward. The full backup,
 * with the original files, is made by `npm run backup` on the office computer.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await loadSettings();
  const { id } = await params;

  const limit = rateLimit(`record-pdf:${clientIp(req)}`, 20, 10 * 60_000);
  if (!limit.ok) return json({ error: 'Too many requests. Wait a moment and try again.' }, { status: 429 });

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      truck: true, additionalDriver: true, contracts: true, checklists: true,
      documents: true, messages: true, events: true,
    },
  });
  if (!booking) return json({ error: 'Booking not found.' }, { status: 404 });

  const record = buildRecord(booking as unknown as BookingSource);

  const photos: RecordPhoto[] = [];
  for (const f of record.files) {
    if (photos.length >= MAX_PHOTOS) break;
    if (f.removed || !TRUCK_PHOTO_KINDS.has(f.kind)) continue;
    try {
      const blob = await readBlob(f.pathname);
      if (!blob) continue;
      const image = Buffer.from(await new Response(blob.stream).arrayBuffer());
      const jpeg = await sharp(image).rotate().resize({ width: 900, withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
      photos.push({ label: f.label, jpeg });
    } catch (err) {
      console.error('record pdf: could not read a photo', err);
    }
  }

  const { bytes } = await renderRecordPdf(record, {
    photos,
    fileNames: {},
    cloudOnly: true,
    generatedAt: new Date(),
    // every truck's code, not just this booking's: a code may have changed, or the truck been swapped
    hide: (await prisma.truck.findMany({ select: { lockboxCode: true } })).map((t) => t.lockboxCode).filter(Boolean),
  });

  const safeRef = booking.reference.replace(/[^A-Za-z0-9-]/g, '');
  return new Response(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="record-${safeRef}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
