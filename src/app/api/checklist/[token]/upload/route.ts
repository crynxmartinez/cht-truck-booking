import { DocKind, DocPhase } from '@prisma/client';
import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { clientIp, json, rateLimit } from '@/lib/http';
import { blobConfigured, normaliseImage, recordDocument, storeFile } from '@/lib/storage';
import { SLOT_KINDS } from '@/lib/checklist-steps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** POST /api/checklist/[token]/upload — one photo at a time, from the phone. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const limit = rateLimit(`clupload:${clientIp(req)}`, 40, 10 * 60_000);
  if (!limit.ok) return json({ error: 'Too many uploads. Please wait a moment.' }, { status: 429 });

  const checklist = await prisma.checklist.findUnique({
    where: { token },
    include: { booking: { select: { id: true, reference: true, stage: true } } },
  });
  if (!checklist) return json({ error: 'This link is not valid.' }, { status: 404 });
  if (checklist.submittedAt) return json({ error: 'This checklist was already submitted.' }, { status: 409 });
  if (checklist.booking.stage === 'CANCELLED') return json({ error: 'This booking was cancelled.' }, { status: 410 });

  if (!blobConfigured()) {
    return json({ error: 'Photo storage is not connected yet. Please call us.' }, { status: 503 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: 'Could not read that upload.' }, { status: 400 });
  }

  const file = form.get('file');
  const slot = String(form.get('slot') ?? '');
  const kindName = SLOT_KINDS[slot];

  if (!(file instanceof File)) return json({ error: 'No file received.' }, { status: 400 });
  if (!kindName) return json({ error: 'Unknown photo type.' }, { status: 400 });
  if (file.size > config.maxUploadBytes) {
    return json(
      { error: `That file is over ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB.` },
      { status: 413 },
    );
  }

  const count = await prisma.document.count({
    where: { bookingId: checklist.bookingId, phase: checklist.phase as unknown as DocPhase },
  });
  if (count > 40) return json({ error: 'That is a lot of photos — please call us instead.' }, { status: 429 });

  try {
    const raw = Buffer.from(await file.arrayBuffer());
    const norm = await normaliseImage(raw, file.type || 'application/octet-stream');

    const stored = await storeFile({
      data: norm.data,
      contentType: norm.contentType,
      ext: norm.ext,
      folder: `bookings/${checklist.booking.reference}/${checklist.phase.toLowerCase()}`,
      name: slot,
    });

    const doc = await recordDocument({
      bookingId: checklist.bookingId,
      kind: DocKind[kindName],
      phase: checklist.phase === 'PICKUP' ? DocPhase.PICKUP : DocPhase.DROPOFF,
      file: stored,
    });

    return json({ id: doc.id, bytes: stored.bytes });
  } catch (err) {
    console.error('checklist upload failed', err);
    return json({ error: 'Upload failed. Please try again.' }, { status: 500 });
  }
}
