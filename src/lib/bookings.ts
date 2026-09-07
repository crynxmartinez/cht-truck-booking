import { Stage } from '@prisma/client';
import { prisma } from './db';
import { logEvent, notifyStaff, setStage } from './notify';
import { markPurgeEligible } from './storage';

/**
 * Booking lifecycle operations shared between the CRM and the cron jobs.
 * Route handlers may only export HTTP verbs, so these live here.
 */

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
}

/** Put a cancelled or auto-released booking back in play. */
export async function reopenBooking(bookingId: string, actor = 'system') {
  await prisma.booking.update({
    where: { id: bookingId },
    data: { stage: Stage.CONTRACT_SENT, cancelledAt: null, cancelledReason: null },
  });
  await logEvent(bookingId, 'reopened', 'Booking reopened', actor);
}
