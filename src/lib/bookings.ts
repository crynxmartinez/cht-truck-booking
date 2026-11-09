import { ChecklistPhase, ContractType, Stage } from '@prisma/client';
import { prisma } from './db';
import { logEvent, notify, notifyStaff, setStage } from './notify';
import { renterNotice, type NoticeKind, type NoticeTemplate } from './renter-notice';
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

/** Someone else moved the card first, so what the screen showed is out of date. */
export class StaleMoveError extends Error {
  constructor(message = 'Someone already moved this booking. The board has been refreshed.') {
    super(message);
    this.name = 'StaleMoveError';
  }
}

/**
 * Move a booking from one stage to another, only if it is still in the stage the
 * screen showed. The check is in the write itself, so two people moving the same
 * card at once cannot both win. Moving INTO Completed closes it out exactly as
 * completing does; moving OUT of Completed undoes that, so the renter's files are
 * not left scheduled for removal under a booking that is active again.
 * The caller has already decided the move is allowed (see stage-moves.ts).
 */
export async function moveBooking(
  bookingId: string,
  from: Stage,
  to: Stage,
  actor: string,
  detail: string,
): Promise<void> {
  if (from === to) return;

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.booking.updateMany({ where: { id: bookingId, stage: from }, data: { stage: to } });
    if (claimed.count === 0) throw new StaleMoveError();

    if (to === Stage.COMPLETED) {
      await tx.booking.update({
        where: { id: bookingId },
        data: { completedAt: new Date(), overdue: false, needsReview: false },
      });
    } else if (from === Stage.COMPLETED) {
      await tx.booking.update({ where: { id: bookingId }, data: { completedAt: null } });
      await tx.document.updateMany({ where: { bookingId }, data: { purgeEligibleAt: null } });
    }
  });

  if (to === Stage.COMPLETED) await markPurgeEligible(bookingId);

  await logEvent(bookingId, 'stage_change', detail, actor, { from, to });
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

/**
 * Cancel a booking.
 *
 * `tellRenter` says whether the renter is also messaged: 'cancelled' when the
 * office chose to, 'released' when the system let the truck go because nobody
 * signed. Nothing is sent once the renter has the truck. A message that cannot
 * be sent never undoes the cancellation; it is recorded on the booking instead,
 * and a failed text shows under Needs attention like any other.
 *
 * Cancelling a booking that is already cancelled does nothing, so a double
 * click or a retry cannot alert the office or message the renter twice. The
 * check is in the write itself, not just before it, so two people cancelling at
 * the same instant cannot both go on to alert and message. `onlyIfStageIn` lets
 * the daily sweep say "only if it is still waiting on a signature": a renter who
 * signs a moment after the sweep picked their booking is left alone.
 */
export async function cancelBooking(
  bookingId: string,
  reason: string,
  actor = 'system',
  options: { tellRenter?: NoticeKind | false; onlyIfStageIn?: Stage[] } = {},
) {
  const before = await prisma.booking.findUnique({ where: { id: bookingId }, select: { stage: true } });
  if (!before) throw new Error('Booking not found.');
  if (before.stage === Stage.CANCELLED) return;

  const cancelled = await prisma.booking.updateMany({
    where: { id: bookingId, stage: options.onlyIfStageIn ? { in: options.onlyIfStageIn } : { not: Stage.CANCELLED } },
    data: { stage: Stage.CANCELLED, cancelledAt: new Date(), cancelledReason: reason || null },
  });
  // Somebody else cancelled it, or it moved on, since it was read: nothing more to do.
  if (cancelled.count === 0) return;
  // Any outstanding paperwork is dead once the booking is off.
  await prisma.contract.updateMany({
    where: { bookingId, status: { in: ['SENT', 'VIEWED'] } },
    data: { status: 'VOID' },
  });
  await logEvent(bookingId, 'cancelled', reason || 'Cancelled', actor);
  await notifyStaff(bookingId, 'cancelled', { detail: reason || null });
  await removeBookingFromCalendar(bookingId);

  const template = renterNotice(options.tellRenter, before.stage);
  if (template) await tellRenter(bookingId, template, actor);
}

/** Send the renter's notice and record what happened. Never throws: the cancellation already stands. */
async function tellRenter(bookingId: string, template: NoticeTemplate, actor: string) {
  try {
    const res = await notify(bookingId, template, { force: true });
    if (res.sent.length) {
      await logEvent(bookingId, 'renter_told', `Renter told it was ${template === 'booking_released' ? 'released' : 'cancelled'}, by ${res.sent.join(' and ').toLowerCase()}`, actor);
    } else {
      await logEvent(bookingId, 'notify_failed', `Could not tell the renter: ${res.errors.join('; ') || 'nothing was sent'}`, actor);
    }
  } catch (err) {
    console.error('renter notice failed', bookingId, err);
    await logEvent(bookingId, 'notify_failed', `Could not tell the renter: ${err instanceof Error ? err.message : String(err)}`, actor);
  }
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
