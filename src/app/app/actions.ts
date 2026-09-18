'use server';

import { revalidatePath } from 'next/cache';
import { Stage } from '@prisma/client';
import { prisma } from '@/lib/db';
import { reassignTruck, NoTruckAvailableError } from '@/lib/availability';
import { cancelBooking, completeBooking, reopenBooking } from '@/lib/bookings';
import { logEvent, notify, notifyStaff, setStage } from '@/lib/notify';
import type { TemplateKey } from '@/lib/messages';
import { isoToDate, isIsoDate } from '@/lib/dates';
import { isEmail, toE164 } from '@/lib/http';

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

/** The CRM has no login, so every action is recorded as the office itself. */
async function actor() {
  return 'ops';
}

function done(message?: string): ActionResult {
  revalidatePath('/app');
  revalidatePath('/app/attention');
  revalidatePath('/app/calendar');
  return { ok: true, message };
}

// ---------------------------------------------------------------- bookings

export async function moveStage(bookingId: string, stage: Stage): Promise<ActionResult> {
  const who = await actor();
  if (stage === Stage.COMPLETED) {
    await completeBooking(bookingId, who);
  } else {
    await setStage(bookingId, stage, who, 'Moved by hand');
  }
  return done('Stage updated.');
}

export async function switchTruck(bookingId: string, truckId: string): Promise<ActionResult> {
  const who = await actor();
  try {
    const updated = await reassignTruck(bookingId, truckId);
    await logEvent(bookingId, 'truck_reassigned', `Moved to Truck ${updated.truck?.code}`, who);
    return done(`Moved to Truck ${updated.truck?.code}.`);
  } catch (err) {
    if (err instanceof NoTruckAvailableError) return { ok: false, error: err.message };
    return { ok: false, error: 'Could not move that booking.' };
  }
}

export async function resend(bookingId: string, template: string): Promise<ActionResult> {
  const who = await actor();
  const res = await notify(bookingId, template as TemplateKey, { force: true });
  await logEvent(bookingId, 'resent', `${template} resent`, who);
  if (res.errors.length) return { ok: false, error: res.errors.join('; ') };
  if (!res.sent.length) return { ok: false, error: 'Nothing was sent — check the GoHighLevel connection.' };
  return done(`Resent by ${res.sent.join(' and ').toLowerCase()}.`);
}

export async function cancel(bookingId: string, reason: string): Promise<ActionResult> {
  const who = await actor();
  await cancelBooking(bookingId, reason || 'Cancelled from the CRM', who);
  return done('Booking cancelled and the truck released.');
}

export async function reopen(bookingId: string): Promise<ActionResult> {
  const who = await actor();
  await reopenBooking(bookingId, who);
  return done('Booking reopened.');
}

export async function clearFlags(bookingId: string): Promise<ActionResult> {
  const who = await actor();
  await prisma.booking.update({
    where: { id: bookingId },
    data: { needsReview: false, rescheduleAsked: false, reviewNote: null },
  });
  await logEvent(bookingId, 'flags_cleared', 'Marked as handled', who);
  return done('Flags cleared.');
}

export async function addNote(bookingId: string, note: string): Promise<ActionResult> {
  const who = await actor();
  const text = note.trim().slice(0, 2000);
  if (!text) return { ok: false, error: 'Write something first.' };
  await logEvent(bookingId, 'note', text, who);
  return done('Note added.');
}

// ---------------------------------------------------------------- fleet

export async function saveTruck(
  truckId: string,
  data: { lockboxCode: string; active: boolean; notes: string },
): Promise<ActionResult> {
  const who = await actor();
  const code = data.lockboxCode.trim().slice(0, 20);
  if (!code) return { ok: false, error: 'The lockbox code cannot be empty.' };

  await prisma.truck.update({
    where: { id: truckId },
    data: { lockboxCode: code, active: data.active, notes: data.notes.trim().slice(0, 500) || null },
  });
  console.info(`[audit] ${who} updated truck ${truckId}`);
  revalidatePath('/app/trucks');
  return { ok: true, message: 'Truck saved.' };
}

export async function addBlackout(
  truckId: string,
  startDate: string,
  endDate: string,
  reason: string,
): Promise<ActionResult> {
  await actor();
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) return { ok: false, error: 'Pick both dates.' };
  if (endDate < startDate) return { ok: false, error: 'The end date is before the start date.' };
  if (!reason.trim()) return { ok: false, error: 'Say what it is for — service, repair, personal use.' };

  const clash = await prisma.booking.findFirst({
    where: {
      truckId,
      stage: { notIn: ['COMPLETED', 'CANCELLED'] },
      blockStart: { lte: isoToDate(endDate) },
      blockEnd: { gte: isoToDate(startDate) },
    },
    select: { reference: true },
  });
  if (clash) return { ok: false, error: `That truck is already booked in those dates (${clash.reference}).` };

  await prisma.blackoutDate.create({
    data: {
      truckId,
      startDate: isoToDate(startDate),
      endDate: isoToDate(endDate),
      reason: reason.trim().slice(0, 200),
    },
  });
  revalidatePath('/app/blackouts');
  revalidatePath('/app/calendar');
  return { ok: true, message: 'Blackout added.' };
}

export async function removeBlackout(id: string): Promise<ActionResult> {
  await actor();
  await prisma.blackoutDate.delete({ where: { id } });
  revalidatePath('/app/blackouts');
  revalidatePath('/app/calendar');
  return { ok: true, message: 'Blackout removed.' };
}

// ---------------------------------------------------------------- dates

/**
 * Move a booking. `days` is explicit so a genuine two-day exception is possible
 * without changing the default for everybody.
 */
export async function changeDates(
  bookingId: string,
  newPickup: string,
  days: number,
  reason: string,
): Promise<ActionResult> {
  const who = await actor();
  if (!isIsoDate(newPickup)) return { ok: false, error: 'Pick a valid date.' };
  if (!Number.isFinite(days) || days < 1 || days > 30) return { ok: false, error: 'Length must be 1 to 30 days.' };

  try {
    const { rescheduleBooking } = await import('@/lib/availability');
    const res = await rescheduleBooking(bookingId, newPickup, days);

    // Date-driven messages are idempotent per booking, so their log rows would
    // suppress the sends for the NEW date. Clear them so they fire again.
    await prisma.messageLog.deleteMany({
      where: {
        bookingId,
        template: { in: ['pickup_morning', 'return_day', 'pickup_no_show_check', 'overdue', 'staff_overdue'] },
      },
    });

    await logEvent(
      bookingId,
      'dates_changed',
      `Moved from ${res.from.start}–${res.from.end} to ${res.to.start}–${res.to.end}` + (reason ? ` — ${reason}` : ''),
      who,
    );

    // Tell the renter and the office. A silent move means somebody turns up on
    // the wrong day.
    await notify(bookingId, 'dates_changed', { force: true });
    await notifyStaff(bookingId, 'dates_changed', { detail: reason || null });

    return done(`Moved to ${res.to.start} – ${res.to.end}. The renter has been told.`);
  } catch (err) {
    if (err instanceof NoTruckAvailableError) return { ok: false, error: err.message };
    console.error('changeDates failed', err);
    return { ok: false, error: 'Could not move that booking.' };
  }
}

// ---------------------------------------------------------------- approvals

export async function approveContractAction(contractId: string): Promise<ActionResult> {
  await actor();
  try {
    const { approveContract } = await import('@/lib/approvals');
    const r = await approveContract(contractId);
    if (r.alreadySigned) return { ok: true, message: 'Already signed.' };
    return done(r.confirmed ? 'Signed. The renter has been confirmed.' : 'Signed. Still waiting on another signature.');
  } catch (err) {
    const { ApprovalError } = await import('@/lib/approvals');
    if (err instanceof ApprovalError) return { ok: false, error: err.message };
    console.error('approveContract failed', err);
    return { ok: false, error: 'Could not sign that.' };
  }
}

export async function approveChecklistAction(checklistId: string): Promise<ActionResult> {
  await actor();
  try {
    const { approveChecklist } = await import('@/lib/approvals');
    const r = await approveChecklist(checklistId);
    if (r.alreadySigned) return { ok: true, message: 'Already signed.' };
    return done('Signed off.');
  } catch (err) {
    const { ApprovalError } = await import('@/lib/approvals');
    if (err instanceof ApprovalError) return { ok: false, error: err.message };
    console.error('approveChecklist failed', err);
    return { ok: false, error: 'Could not sign that.' };
  }
}

// ---------------------------------------------------------------- recipients

export async function saveRecipient(input: {
  id?: string;
  name: string;
  email: string;
  phone: string;
  role: 'MAIN_ADMIN' | 'ADMIN';
  notifyEmail: boolean;
  notifySms: boolean;
  active: boolean;
}): Promise<ActionResult> {
  await actor();

  const name = input.name.trim().slice(0, 120);
  const email = input.email.trim().toLowerCase().slice(0, 254);
  const phone = toE164(input.phone.trim());

  if (name.length < 2) return { ok: false, error: 'Enter their name.' };
  if (!isEmail(email)) return { ok: false, error: 'Enter a valid email address.' };
  if (!phone) return { ok: false, error: 'Enter a 10-digit US mobile number.' };

  const clash = await prisma.notificationRecipient.findFirst({
    where: { email, ...(input.id ? { id: { not: input.id } } : {}) },
  });
  if (clash) return { ok: false, error: 'Somebody on the list already uses that email.' };

  const data = {
    name, email, phone,
    role: input.role,
    notifyEmail: input.notifyEmail,
    notifySms: input.notifySms,
    active: input.active,
  };

  const saved = input.id
    ? await prisma.notificationRecipient.update({ where: { id: input.id }, data })
    : await prisma.notificationRecipient.create({ data });

  // Contact details changed means the cached GHL id may point elsewhere.
  if (input.id) {
    await prisma.notificationRecipient.updateMany({
      where: { id: input.id, OR: [{ email: { not: email } }, { phone: { not: phone } }] },
      data: { ghlContactId: null },
    });
  }

  // Exactly one main admin. Promoting somebody demotes the incumbent.
  if (input.role === 'MAIN_ADMIN') {
    await prisma.notificationRecipient.updateMany({
      where: { id: { not: saved.id }, role: 'MAIN_ADMIN' },
      data: { role: 'ADMIN' },
    });
  }

  revalidatePath('/app/notifications');
  return { ok: true, message: `${saved.name} saved.` };
}

export async function saveRecipientSignature(id: string, signatureData: string): Promise<ActionResult> {
  await actor();
  if (!/^data:image\/(png|jpeg);base64,/.test(signatureData)) {
    return { ok: false, error: 'Draw or type a signature first.' };
  }
  if (signatureData.length > 900_000) return { ok: false, error: 'That signature image is too large.' };

  await prisma.notificationRecipient.update({ where: { id }, data: { signatureData } });
  revalidatePath('/app/notifications');
  return { ok: true, message: 'Signature saved. It is stamped on each approval from now on.' };
}

export async function removeRecipient(id: string): Promise<ActionResult> {
  await actor();
  const r = await prisma.notificationRecipient.findUnique({ where: { id } });
  if (!r) return { ok: false, error: 'Already gone.' };

  if (r.role === 'MAIN_ADMIN') {
    return {
      ok: false,
      error: 'That is the main admin, who signs the paperwork. Make somebody else main admin first.',
    };
  }

  await prisma.notificationRecipient.delete({ where: { id } });
  revalidatePath('/app/notifications');
  return { ok: true, message: `${r.name} removed from the list.` };
}
