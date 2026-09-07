import { after } from 'next/server';
import { ChecklistPhase, ContractType, Stage } from '@prisma/client';
import { prisma } from '@/lib/db';
import { createBookingWithTruck, NoTruckAvailableError } from '@/lib/availability';
import { earliestBookable, isIsoDate, latestBookable, rentalWindow } from '@/lib/dates';
import { cleanString, clientIp, isEmail, json, preflight, rateLimit, toE164 } from '@/lib/http';
import { newReference, newToken } from '@/lib/tokens';
import { adoptDraftDocuments } from '@/lib/storage';
import { logEvent, notify, notifyStaff, setStage } from '@/lib/notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function OPTIONS(req: Request) {
  return preflight(req.headers.get('origin'));
}

/**
 * POST /api/public/bookings
 *
 * Creates the booking, assigns a truck under a row lock, then sets up the
 * paperwork: a rental contract and both checklist records, each with its own
 * unguessable token. Messaging happens after the row is committed so a GHL
 * outage can never lose somebody's booking.
 */
export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  const ip = clientIp(req);

  const limit = rateLimit(`booking:${ip}`, 6, 10 * 60_000);
  if (!limit.ok) {
    return json({ error: 'Too many booking attempts. Please wait a few minutes.' }, { status: 429, origin });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Could not read that request.' }, { status: 400, origin });
  }

  // Honeypot: a real person never fills a hidden field.
  if (cleanString(body.hp)) {
    return json({ ok: true, reference: 'CHT-000000' }, { origin });
  }

  const pickupDate = cleanString(body.pickupDate, 10);
  const firstName = cleanString(body.firstName, 60);
  const lastName = cleanString(body.lastName, 60);
  const email = cleanString(body.email, 254).toLowerCase();
  const phone = toE164(cleanString(body.phone, 32));
  const draftId = cleanString(body.draftId, 64);
  const sourceUrl = cleanString(body.pageUrl, 500);

  const problems: string[] = [];
  if (!isIsoDate(pickupDate)) problems.push('Pick a valid pickup date.');
  if (firstName.length < 2) problems.push('Enter your first name.');
  if (lastName.length < 2) problems.push('Enter your last name.');
  if (!isEmail(email)) problems.push('Enter a valid email address.');
  if (!phone) problems.push('Enter a 10-digit US mobile number.');
  if (problems.length) return json({ error: problems[0], problems }, { status: 400, origin });

  if (pickupDate < earliestBookable()) {
    return json({ error: 'That date is too soon — please choose a later one.' }, { status: 400, origin });
  }
  if (pickupDate > latestBookable()) {
    return json({ error: 'That date is further out than we take bookings.' }, { status: 400, origin });
  }

  // Both documents must be on file. The widget enforces this too, but the API
  // is the surface that actually matters.
  if (draftId) {
    const docs = await prisma.document.findMany({
      where: { draftId, bookingId: null },
      select: { kind: true },
    });
    const kinds = new Set(docs.map((d) => d.kind));
    if (!kinds.has('DRIVER_LICENSE') || !kinds.has('INSURANCE')) {
      return json({ error: 'Please upload both your driver’s licence and proof of insurance.' }, { status: 400, origin });
    }
  } else {
    return json({ error: 'Please upload your driver’s licence and proof of insurance.' }, { status: 400, origin });
  }

  // ---- create ------------------------------------------------------------
  let booking;
  try {
    booking = await createBookingWithTruck({
      pickupDate,
      reference: newReference(),
      firstName,
      lastName,
      email,
      phone,
      draftId,
      sourceUrl: sourceUrl || null,
    });
  } catch (err) {
    if (err instanceof NoTruckAvailableError) {
      return json({ error: err.message }, { status: 409, origin });
    }
    console.error('booking create failed', err);
    return json({ error: 'Something went wrong creating your booking. Please try again.' }, { status: 500, origin });
  }

  const window = rentalWindow(pickupDate);

  // ---- paperwork ---------------------------------------------------------
  try {
    await adoptDraftDocuments(draftId, booking.id);

    await prisma.$transaction([
      prisma.contract.create({
        data: {
          bookingId: booking.id,
          type: ContractType.RENTAL_AGREEMENT,
          token: newToken(),
        },
      }),
      prisma.checklist.create({
        data: { bookingId: booking.id, phase: ChecklistPhase.PICKUP, token: newToken() },
      }),
      prisma.checklist.create({
        data: { bookingId: booking.id, phase: ChecklistPhase.DROPOFF, token: newToken() },
      }),
    ]);

    await logEvent(
      booking.id,
      'booking_created',
      `Booked ${window.pickupDate} → ${window.returnDate}, auto-assigned Truck ${booking.truck?.code ?? '?'}`,
      'renter',
      { ip },
    );
  } catch (err) {
    console.error('paperwork setup failed', err);
    // The booking exists; the office can repair the rest from the CRM.
  }

  // ---- notify, AFTER the response has gone out ---------------------------
  // Two messages over GoHighLevel means a contact upsert plus four sends, and
  // that was roughly ten seconds of the customer watching a spinner for work
  // they do not care about. The booking is already committed by this point, so
  // the confirmation screen does not need to wait for the texts to leave.
  after(async () => {
    try {
      await notify(booking.id, 'booking_received');
      await notify(booking.id, 'contract_to_sign');
      await setStage(booking.id, Stage.CONTRACT_SENT, 'system', 'Rental agreement sent automatically');
      await notifyStaff(booking.id, 'booking_received');
    } catch (err) {
      console.error('notify failed', err);
      await logEvent(booking.id, 'notify_failed', String(err), 'system');
    }
  });

  return json(
    {
      ok: true,
      reference: booking.reference,
      pickupDate: window.pickupDate,
      returnDate: window.returnDate,
    },
    { origin },
  );
}
