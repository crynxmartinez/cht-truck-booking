'use server';

import { revalidatePath } from 'next/cache';
import { Stage } from '@prisma/client';
import { prisma } from '@/lib/db';
import { reassignTruck, NoTruckAvailableError } from '@/lib/availability';
import { cancelBooking, completeBooking, reopenBooking } from '@/lib/bookings';
import { logEvent, notify, setStage } from '@/lib/notify';
import type { TemplateKey } from '@/lib/messages';
import { isoToDate, isIsoDate } from '@/lib/dates';

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
