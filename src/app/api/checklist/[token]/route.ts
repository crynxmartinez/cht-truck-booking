import { ChecklistCompletionSource } from '@prisma/client';
import { prisma } from '@/lib/db';
import { cleanString, clientIp, isEmail, json, rateLimit } from '@/lib/http';
import { completeChecklist, MissingChecklistEvidenceError } from '@/lib/checklist-completion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/checklist/[token] — final submit.
 *
 * Pickup moves the booking to In Use. Drop-off moves it to Returned and fires
 * the thank-you; the retention clock only starts once the office marks the
 * booking Completed, so photos are never purged while a claim is open.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const limit = rateLimit(`checklist:${clientIp(req)}`, 30, 10 * 60_000);
  if (!limit.ok) return json({ error: 'Too many attempts. Please wait a few minutes.' }, { status: 429 });

  const checklist = await prisma.checklist.findUnique({
    where: { token },
    include: { booking: { select: { id: true, stage: true, reference: true } } },
  });
  if (!checklist) return json({ error: 'This link is not valid.' }, { status: 404 });
  if (checklist.submittedAt) return json({ ok: true, alreadySubmitted: true });
  if (checklist.booking.stage === 'CANCELLED') return json({ error: 'This booking was cancelled.' }, { status: 410 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Could not read that request.' }, { status: 400 });
  }

  const firstName = cleanString(body.firstName, 60);
  const lastName = cleanString(body.lastName, 60);
  const email = cleanString(body.email, 254).toLowerCase();
  const phone = cleanString(body.phone, 32);
  const reportedTime = cleanString(body.reportedTime, 20);
  const notes = cleanString(body.notes, 2000);

  if (firstName.length < 2 || lastName.length < 2) return json({ error: 'Please enter your full name.' }, { status: 400 });
  if (!isEmail(email)) return json({ error: 'Please enter a valid email.' }, { status: 400 });
  if (phone.replace(/\D/g, '').length < 10) return json({ error: 'Please enter your mobile number.' }, { status: 400 });
  if (!reportedTime) return json({ error: 'Please tell us the time.' }, { status: 400 });

  try {
    await prisma.checklist.update({
      where: { id: checklist.id },
      data: { firstName, lastName, email, phone },
    });
    await completeChecklist({
      checklistId: checklist.id,
      source: ChecklistCompletionSource.RENTER,
      actor: 'renter',
      reportedTime,
      notes: notes || null,
    });
  } catch (err) {
    if (err instanceof MissingChecklistEvidenceError) {
      return json({ error: `Please add the ${err.labels[0].toLowerCase()} photo before submitting.` }, { status: 400 });
    }
    console.error('checklist submit failed', err);
    return json({ error: 'We could not submit that checklist. Please try again.' }, { status: 500 });
  }

  return json({ ok: true });
}
