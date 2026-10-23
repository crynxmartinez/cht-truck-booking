import { ChecklistPhase, ContractType, Stage } from '@prisma/client';
import { prisma } from './db';
import { logEvent, notifyStaff, setStage } from './notify';
import { markPurgeEligible } from './storage';
import { newToken } from './tokens';
import { NoTruckAvailableError } from './availability';
import { isOverlapViolation } from './overlap-guard';
import { removeBookingFromCalendar, syncBookingToCalendar } from './calendar-sync';

/**
 * Booking lifecycle operations shared between the CRM and the cron jobs.
 * Route handlers may only export HTTP verbs, so these live here.
 */

/**
 * The rental agreement and both checklists, each with its own unguessable
 * token. Shared by the widget and the office so the two can never drift into
 * creating a booking that is missing one of its links.
 */
export async function createPaperwork(bookingId: string) {
  await prisma.$transaction([
    prisma.contract.create({
      data: { bookingId, type: ContractType.RENTAL_AGREEMENT, token: newToken() },
    }),
    prisma.checklist.create({ data: { bookingId, phase: ChecklistPhase.PICKUP, token: newToken() } }),
    prisma.checklist.create({ data: { bookingId, phase: ChecklistPhase.DROPOFF, token: newToken() } }),
  ]);
}

/** Close a booking out: releases the truck and starts the retention clock. */
export async function completeBooking(bookingId: string, actor = 'system') {
  await setStage(bookingId, Stage.COMPLETED, actor, 'Booking closed');
  await prisma.booking.update({
    where: { id: bookingId },
    data: { completedAt: new Date(), overdue: false, needsReview: false },
  });
  await markPurgeEligible(bookingId);
}

export async function cancelBooking(bookingId: string, reason: string, actor = 'system') {
  await prisma.booking.update({
    where: { id: bookingId },
    data: { stage: Stage.CANCELLED, cancelledAt: new Date(), cancelledReason: reason || null },
  });
  // Any outstanding paperwork is dead once the booking is off.
  await prisma.contract.updateMany({
    where: { bookingId, status: { in: ['SENT', 'VIEWED'] } },
    data: { status: 'VOID' },
  });
  await logEvent(bookingId, 'cancelled', reason || 'Cancelled', actor);
  await notifyStaff(bookingId, 'cancelled', { detail: reason || null });
  await removeBookingFromCalendar(bookingId);
}

/** Put a cancelled or auto-released booking back in play. */
export async function reopenBooking(bookingId: string, actor = 'system') {
  try {
    await prisma.booking.update({
      where: { id: bookingId },
      data: { stage: Stage.CONTRACT_SENT, cancelledAt: null, cancelledReason: null },
    });
  } catch (err) {
    // A cancelled booking gave its truck up, and the next renter may have it now.
    // Reopening used to re-enter the same days unchecked and double-book it.
    if (isOverlapViolation(err)) {
      throw new NoTruckAvailableError(
        'That truck has since been booked on those dates, so this booking cannot be reopened. Move it to the other truck or other dates first.',
      );
    }
    throw err;
  }
  await logEvent(bookingId, 'reopened', 'Booking reopened', actor);
  await syncBookingToCalendar(bookingId);
}
