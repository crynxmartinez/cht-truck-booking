import { ChecklistCompletionSource, DocumentSource } from '@prisma/client';
import { prisma } from '@/lib/db';
import { completeChecklist, MissingChecklistEvidenceError } from '@/lib/checklist-completion';
import { cleanString, clientIp, json, rateLimit } from '@/lib/http';
import { logEvent } from '@/lib/notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: bookingId } = await params;
  const limit = rateLimit(`staff-dropoff-finalize:${clientIp(req)}`, 30, 10 * 60_000);
  if (!limit.ok) return json({ error: 'Too many attempts. Wait a moment and try again.' }, { status: 429 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Could not read that request.' }, { status: 400 });
  }

  const documentIds = Array.isArray(body.documentIds)
    ? body.documentIds.filter((id: unknown) => typeof id === 'string').slice(0, 60)
    : [];
  const uploadedBy = cleanString(body.uploadedBy, 120) || 'Diana Alsup';
  const note = cleanString(body.note, 2000);
  const reportedTime = cleanString(body.reportedTime, 20);
  const overrideReason = cleanString(body.overrideReason, 1000);
  const complete = body.complete === true;

  if (!documentIds.length) return json({ error: 'Upload at least one photo first.' }, { status: 400 });
  const documents = await prisma.document.findMany({
    where: {
      id: { in: documentIds },
      bookingId,
      phase: 'DROPOFF',
      source: { in: [DocumentSource.STAFF_EMAIL, DocumentSource.STAFF_SMS, DocumentSource.STAFF_OTHER] },
      deletedAt: null,
    },
    select: { id: true, kind: true },
  });
  if (documents.length !== new Set(documentIds).size) {
    return json({ error: 'One of those photos does not belong to this reservation.' }, { status: 400 });
  }

  const counts = new Map<string, number>();
  for (const document of documents) counts.set(document.kind, (counts.get(document.kind) ?? 0) + 1);
  const summary = [...counts]
    .map(([kind, count]) => `${kind.replaceAll('_', ' ').toLowerCase()}${count > 1 ? ` ×${count}` : ''}`)
    .join(', ');

  const uploadDetail = `${uploadedBy} uploaded ${documents.length} return photo${documents.length === 1 ? '' : 's'} received outside the checklist: ${summary}${note ? ` · “${note}”` : ''}`;

  if (!complete) {
    await logEvent(bookingId, 'staff_dropoff_photos', uploadDetail, uploadedBy, {
      documentIds,
      source: 'staff',
      completeRequested: false,
    });
    return json({ ok: true, completed: false });
  }
  if (!reportedTime) return json({ error: 'Enter the time the truck was returned.' }, { status: 400 });

  const checklist = await prisma.checklist.findUnique({
    where: { bookingId_phase: { bookingId, phase: 'DROPOFF' } },
    select: { id: true },
  });
  if (!checklist) return json({ error: 'This reservation has no drop-off checklist.' }, { status: 409 });

  try {
    const result = await completeChecklist({
      checklistId: checklist.id,
      source: ChecklistCompletionSource.STAFF,
      actor: uploadedBy,
      reportedTime,
      notes: note || null,
      overrideReason: overrideReason || null,
    });
    await logEvent(bookingId, 'staff_dropoff_photos', uploadDetail, uploadedBy, {
      documentIds,
      source: 'staff',
      completeRequested: true,
    });
    return json({ ok: true, completed: true, alreadySubmitted: result.alreadySubmitted });
  } catch (err) {
    if (err instanceof MissingChecklistEvidenceError) {
      return json(
        {
          error: `Missing required return evidence: ${err.labels.join(', ')}. Add it, or enter an override reason.`,
          missing: err.labels,
        },
        { status: 400 },
      );
    }
    console.error('staff drop-off completion failed', { bookingId, err });
    return json({ error: err instanceof Error ? err.message : 'Could not complete the return.' }, { status: 500 });
  }
}
