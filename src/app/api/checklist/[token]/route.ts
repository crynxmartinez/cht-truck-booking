import { Stage } from '@prisma/client';
import { prisma } from '@/lib/db';
import { cleanString, clientIp, isEmail, json, rateLimit } from '@/lib/http';
import { logEvent, notify, notifyStaff, setStage } from '@/lib/notify';
import { buildSteps } from '@/lib/checklist-steps';

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

  // Server-side check that every required photo actually landed.
  const docs = await prisma.document.findMany({
    where: {
      bookingId: checklist.bookingId,
      phase: checklist.phase === 'PICKUP' ? 'PICKUP' : 'DROPOFF',
      deletedAt: null,
    },
    select: { kind: true },
  });
  const have = new Set(docs.map((d) => d.kind));

  for (const step of buildSteps(checklist.phase)) {
    for (const u of step.uploads ?? []) {
      if (!u.required) continue;
      const kind = { cargo: 'CARGO', exterior: 'EXTERIOR', fuel: 'FUEL_GAUGE', other: 'OTHER' }[u.key];
      if (kind && !have.has(kind as never)) {
        return json({ error: `Please add the ${u.label.toLowerCase()} photo before submitting.` }, { status: 400 });
      }
    }
  }

  await prisma.checklist.update({
    where: { id: checklist.id },
    data: { firstName, lastName, email, phone, reportedTime, notes: notes || null, submittedAt: new Date() },
  });

  const isReturn = checklist.phase === 'DROPOFF';
  await logEvent(
    checklist.bookingId,
    isReturn ? 'dropoff_checklist' : 'pickup_checklist',
    `${isReturn ? 'Returned' : 'Picked up'} at ${reportedTime}${notes ? ` — "${notes}"` : ''}`,
    'renter',
  );

  try {
    if (isReturn) {
      await setStage(checklist.bookingId, Stage.RETURNED, 'system', 'Return checklist submitted');
      await notify(checklist.bookingId, 'thank_you');
      await notifyStaff(checklist.bookingId, 'returned', { reportedTime, detail: notes || null });
      // Photos become purge-eligible only once the office closes the booking.
      if (notes) {
        await prisma.booking.update({ where: { id: checklist.bookingId }, data: { needsReview: true, reviewNote: notes } });
      }
    } else {
      await setStage(checklist.bookingId, Stage.IN_USE, 'system', 'Pickup checklist submitted');
      await notifyStaff(checklist.bookingId, 'picked_up', { reportedTime });
    }
  } catch (err) {
    console.error('checklist post-submit failed', err);
  }

  return json({ ok: true });
}
