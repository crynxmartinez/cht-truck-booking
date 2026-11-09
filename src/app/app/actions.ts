'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { MessageChannel, Stage } from '@prisma/client';
import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { reassignTruck, NoTruckAvailableError, SwapNotAllowedError } from '@/lib/availability';
import { cancelBooking, moveBooking, reopenBooking, StaleMoveError } from '@/lib/bookings';
import { logEvent, notify, notifyStaff, setStage } from '@/lib/notify';
import type { TemplateKey } from '@/lib/messages';
import { addDays, dateToIso, isoToDate, isIsoDate, latestBookable, todayInOps } from '@/lib/dates';
import { checkBooking, type Limits } from '@/lib/booking-rules';
import { distinctRenters, renterWhere, type Renter } from '@/lib/renter-search';
import { syncBookingToCalendar } from '@/lib/calendar-sync';
import { OVERLAP_MESSAGE, isOverlapViolation } from '@/lib/overlap-guard';
import { isEmail, toE164 } from '@/lib/http';
import { loadSettings } from '@/lib/settings';
import { canAddMainAdmin, canStopBeingMainAdmin, type Approver } from '@/lib/approvers';
import { prepareOfficeMessage, type OfficeMessageInput, type Preview } from '@/lib/office-message';
import { checkConsent, consentLogLine } from '@/lib/sms-consent';
import { ackCovers, checkMove, isAck, isBoardStage, type Ack } from '@/lib/stage-moves';
import { STAGE_LABEL } from '@/lib/stages';
import { otherChannelsChanged } from '@/lib/sms-block';
import { allowSms, getSmsBlock } from '@/lib/ghl';

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

/** The CRM has no login, so every action is recorded as the office itself. */
async function actor() {
  // Every CRM action starts here, so it sees the settings the office last saved.
  await loadSettings();
  return 'ops';
}

function done(message?: string): ActionResult {
  revalidatePath('/app');
  revalidatePath('/app/attention');
  revalidatePath('/app/calendar');
  return { ok: true, message };
}

// ---------------------------------------------------------------- bookings

/**
 * Turns "the truck is taken" into something to tell a person. Moving a card or
 * reopening a booking can put it back into the days another renter now holds;
 * the database refuses that, and neither path used to say so — it just failed.
 */
function truckTaken(err: unknown): ActionResult | null {
  if (err instanceof NoTruckAvailableError) return { ok: false, error: err.message };
  if (isOverlapViolation(err)) {
    return { ok: false, error: `${OVERLAP_MESSAGE} Move it to the other truck or other dates first.` };
  }
  return null;
}

export type MoveResult =
  | { ok: true; message: string }
  | { ok: false; error: string; stale?: boolean; /** where the booking is now, when known */ now?: Stage }
  /** Nothing was changed: the person has to agree to more first, then ask again. */
  | { ok: false; needs: 'confirm' | 'override'; reasons: readonly string[] };

/** True when every agreement on the booking is signed by the renter and approved. Same test approvals.ts uses to confirm. */
function allApproved(contracts: Array<{ status: string; counterSignedAt: Date | null }>): boolean {
  const live = contracts.filter((k) => k.status !== 'VOID');
  return live.length > 0 && live.every((k) => !['SENT', 'VIEWED'].includes(k.status) && k.counterSignedAt !== null);
}

const MOVE_VIA = { drag: 'Moved by drag', button: 'Moved by hand', undo: 'Move undone' } as const;

/**
 * Move a card to another column, from the Board (drag) or the booking (button).
 *
 * `expectedFrom` is the column the screen showed; if someone else moved the card
 * first, nothing happens. The rules in stage-moves.ts decide whether the move just
 * happens, needs a yes, or needs an override, and they are checked here, so the
 * screen cannot skip them. Whatever the person agreed to is written on the booking.
 */
export async function moveCard(
  bookingId: string,
  expectedFrom: string,
  to: string,
  ack: string = 'none',
  via: string = 'button',
): Promise<MoveResult> {
  const who = await actor();

  if (typeof bookingId !== 'string' || !bookingId) return { ok: false, error: 'That booking was not understood.' };
  if (!isBoardStage(expectedFrom) || !isBoardStage(to)) return { ok: false, error: 'That move is not possible from here.' };
  if (!isAck(ack) || !Object.hasOwn(MOVE_VIA, via)) return { ok: false, error: 'That move was not understood.' };
  if (via === 'drag' && !config.boardDrag) return { ok: false, error: 'Dragging is switched off in Settings.' };

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      stage: true,
      pickupDate: true,
      returnDate: true,
      contracts: { select: { status: true, counterSignedAt: true } },
    },
  });
  if (!booking) return { ok: false, error: 'That booking was not found.' };
  if (booking.stage !== expectedFrom) {
    return { ok: false, error: 'Someone already moved this booking. The board has been refreshed.', stale: true, now: booking.stage };
  }

  const verdict = checkMove({
    from: booking.stage,
    to,
    pickupIso: dateToIso(booking.pickupDate),
    returnIso: dateToIso(booking.returnDate),
    todayIso: todayInOps(),
    approvalComplete: allApproved(booking.contracts),
  });

  if (!ackCovers(verdict, ack as Ack)) {
    return { ok: false, needs: verdict.level === 'blocked' ? 'override' : 'confirm', reasons: verdict.level === 'ok' ? [] : verdict.reasons };
  }

  // What the office agreed to goes on the booking, so a later reader can see why.
  const agreed =
    verdict.level === 'ok'
      ? ''
      : verdict.level === 'blocked'
        ? ` (office override: ${verdict.reasons.join(' ')})`
        : ` (office confirmed: ${verdict.reasons.join(' ')})`;

  try {
    await moveBooking(bookingId, booking.stage, to, who, `${MOVE_VIA[via as keyof typeof MOVE_VIA]}: ${STAGE_LABEL[booking.stage]} to ${STAGE_LABEL[to]}${agreed}`);
  } catch (err) {
    if (err instanceof StaleMoveError) return { ok: false, error: err.message, stale: true };
    const refusal = truckTaken(err);
    if (refusal && !refusal.ok) return { ok: false, error: refusal.error };
    throw err;
  }

  // The calendar title and colour depend on the stage (a rental waiting on
  // approval is shown unconfirmed). The move has already happened, so a calendar
  // hiccup is reported, not allowed to undo it.
  try {
    await syncBookingToCalendar(bookingId);
  } catch (err) {
    console.error('calendar sync after move failed', err);
    await logEvent(bookingId, 'calendar_sync_failed', 'The stage changed but the calendar could not be updated.', 'system');
  }

  done();
  return { ok: true, message: `Moved to ${STAGE_LABEL[to]}.` };
}

export async function switchTruck(bookingId: string, truckId: string): Promise<ActionResult> {
  const who = await actor();
  try {
    const moved = await reassignTruck(bookingId, truckId);
    const from = moved.previousTruckCode ? `Truck ${moved.previousTruckCode}` : 'no truck';
    const to = `Truck ${moved.truck?.code}`;

    // The signed agreement is a stored PDF naming the old truck's plate and
    // year. It cannot change, so the log is where the substitution is recorded.
    await logEvent(
      bookingId,
      'truck_reassigned',
      `Moved from ${from} to ${to}. Any signed agreement still lists the previous truck's plate.`,
      who,
    );
    // Same days, different truck — the title and colour on the office calendar
    // have to follow, or they load the wrong van.
    await syncBookingToCalendar(bookingId);

    // After the response: two sends over GoHighLevel is seconds of waiting.
    // Forced, because the same booking can legitimately change truck twice.
    after(async () => {
      try {
        const renter = await notify(bookingId, 'truck_changed', { force: true });
        await notifyStaff(bookingId, 'truck_changed', { detail: `${from} to ${to}` }, { force: true });
        // notify() reports a failed send in its result rather than throwing, so
        // without this a GoHighLevel outage would leave no trace at all.
        if (renter.errors.length > 0) {
          await logEvent(bookingId, 'notify_failed', `Truck change: ${renter.errors.join('; ')}`, 'system');
        }
      } catch (err) {
        console.error('truck change notify failed', err);
        await logEvent(bookingId, 'notify_failed', String(err), 'system');
      }
    });

    // Sent after the response, so say so honestly rather than "has been told".
    return done(`Moved to ${to}. The renter and Diana are being told.`);
  } catch (err) {
    if (err instanceof NoTruckAvailableError || err instanceof SwapNotAllowedError) {
      return { ok: false, error: err.message };
    }
    console.error('switchTruck failed', err);
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

/**
 * Turns a renter's texts back on, because THEY asked. This never happens on its
 * own: the office has to say how the renter asked and leave a line another person
 * can check, and the block is read back from GoHighLevel afterwards so the
 * answer is what GoHighLevel now says, not what we hoped. Only texts change;
 * their call and email settings are not touched.
 */
export async function turnTextsBackOn(bookingId: string, way: string, note: string): Promise<ActionResult> {
  const who = await actor();
  const consent = checkConsent(way, note);
  if (!consent.ok) return { ok: false, error: consent.error };

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { ghlContactId: true, reference: true },
  });
  if (!booking) return { ok: false, error: 'That booking was not found.' };
  if (!booking.ghlContactId) {
    return { ok: false, error: 'No text has been sent to this renter yet, so there is nothing to turn back on.' };
  }

  const before = await getSmsBlock(booking.ghlContactId);
  if (!before.ok) return { ok: false, error: `Could not check GoHighLevel: ${before.error}` };
  if (!before.data.blocked) {
    return { ok: false, error: 'GoHighLevel already shows texts as on for this renter. Use Resend to send the message again.' };
  }

  // The reason goes on record BEFORE anything changes in GoHighLevel, and if it
  // cannot be written nothing is changed. (logEvent swallows its own errors, so
  // this writes directly.)
  try {
    await prisma.bookingEvent.create({
      data: { bookingId, type: 'texts_restore_requested', detail: consentLogLine(consent), actor: who },
    });
  } catch (err) {
    console.error('could not record the reason for turning texts back on', err);
    return { ok: false, error: 'Could not write the reason on the booking, so nothing was changed. Try again.' };
  }

  const set = await allowSms(booking.ghlContactId, before.data.settings, 'Renter asked for texts again (recorded in the truck CRM)');
  if (!set.ok) {
    await logEvent(bookingId, 'texts_restore_failed', `GoHighLevel did not accept the change: ${set.error}`, who);
    return {
      ok: false,
      error: `GoHighLevel did not confirm the change (${set.error}). Check the contact in GoHighLevel before relying on it either way.`,
    };
  }

  const after = await getSmsBlock(booking.ghlContactId);
  if (!after.ok) {
    await logEvent(bookingId, 'texts_restore_unconfirmed', `Asked GoHighLevel to turn texts back on, but could not read it back: ${after.error}`, who);
    return {
      ok: false,
      error: 'The change was sent, but we could not read it back to confirm. Check the contact in GoHighLevel before relying on it.',
    };
  }
  if (after.data.blocked) {
    await logEvent(bookingId, 'texts_restore_failed', `Asked GoHighLevel to turn texts back on, but it still shows texts as blocked (${after.data.status}).`, who);
    return {
      ok: false,
      error:
        after.data.status === 'global'
          ? 'This renter is on Do Not Disturb for everything in GoHighLevel, which this button does not change. Check the contact in GoHighLevel.'
          : 'GoHighLevel still shows texts as blocked for this renter, so they were not turned back on. Check the contact in GoHighLevel.',
    };
  }

  const changed = otherChannelsChanged(before.data.settings, after.data.settings);
  if (changed.length) {
    await logEvent(
      bookingId,
      'texts_restore_side_effect',
      `Texts are on, but GoHighLevel also changed these settings: ${changed.join(', ')}. Check the contact.`,
      who,
    );
  }

  await logEvent(bookingId, 'texts_restored', `Confirmed in GoHighLevel. ${consentLogLine(consent)}`, who);
  return done(
    changed.length
      ? `Texts are back on, but GoHighLevel also changed: ${changed.join(', ')}. Check this renter's contact in GoHighLevel.`
      : 'Texts are back on for this renter, confirmed in GoHighLevel. Press Resend for any message they missed.',
  );
}

/**
 * Cancel a booking. `tellRenter` is the office's choice, made on screen: only a
 * real true sends the renter a message, so a missing or malformed value from the
 * browser means nobody is messaged.
 */
export async function cancel(bookingId: string, reason: string, tellRenter: boolean = false): Promise<ActionResult> {
  const who = await actor();
  const tell = tellRenter === true;
  await cancelBooking(bookingId, reason || 'Cancelled from the CRM', who, { tellRenter: tell ? 'cancelled' : false });
  return done(
    tell
      ? 'Booking cancelled and the truck released. The renter is being told by text and email; open the booking and look under Messages sent to see it went.'
      : 'Booking cancelled and the truck released. The renter was not messaged.',
  );
}

export async function reopen(bookingId: string): Promise<ActionResult> {
  const who = await actor();
  try {
    await reopenBooking(bookingId, who);
  } catch (err) {
    const refusal = truckTaken(err);
    if (refusal) return refusal;
    throw err;
  }
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

// ---------------------------------------------------------------- new booking

export type NewBookingInput = {
  fullName: string;
  email: string;
  phone: string;
  pickupDate: string;
  days: number;
  /** '' means let the system pick A before B. */
  truckId: string;
  sendContract: boolean;
  documentsLater: boolean;
  note: string;
};

/** The rules as they stand now, for the shared booking check. */
function bookingLimits(): Limits {
  return {
    today: todayInOps(),
    minLeadDays: config.minLeadDays,
    latest: latestBookable(),
    customerMaxDays: config.customerMaxDays,
  };
}

/**
 * What the office is about to run into, shown live under the date field: which
 * trucks are free, anything that would stop the booking, and anything worth a
 * heads-up that does not (a same-day booking, or one inside the customers'
 * notice or empty days).
 */
export async function checkAvailability(pickupDate: string, days: number) {
  if (!isIsoDate(pickupDate)) return null;
  const { freeTrucksFor } = await import('@/lib/availability');
  await loadSettings();

  const length = Number.isFinite(days) ? days : config.rentalBlockDays;
  const res = await freeTrucksFor(pickupDate, length);
  const verdict = checkBooking('office', pickupDate, length, bookingLimits());
  const notes = verdict.ok ? [...verdict.notes] : [];

  // The customers' empty days: free for the office, but not for a customer.
  const buffer = config.bufferDays;
  if (verdict.ok && buffer > 0 && res.free.length > 0) {
    const wide = await freeTrucksFor(addDays(pickupDate, -buffer), Math.min(30, Math.max(1, length) + buffer * 2));
    if (wide.free.length === 0) {
      notes.push('This is inside the empty days customers must leave around other rentals. That is fine for the office.');
    }
  }

  return { ...res, notes, problem: verdict.ok ? null : verdict.error };
}

/**
 * Past renters matching what is being typed, so a repeat customer is one click
 * rather than retyping their details. Office only; shows at most five.
 */
export async function findRenters(query: string): Promise<Renter[]> {
  await actor();
  const where = typeof query === 'string' ? renterWhere(query) : null;
  if (!where) return [];
  const rows = await prisma.booking.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 40,
    select: { firstName: true, lastName: true, email: true, phone: true },
  });
  return distinctRenters(rows);
}

/**
 * Take a booking on somebody's behalf — the phone call the widget cannot handle.
 *
 * Deliberately looser than the public route in three places: no lead time (a
 * walk-in for tomorrow is most of the point), no document requirement (nobody
 * emails a licence mid-call), and a length the office chooses. The one rule it
 * does not bend is the truck clash, which goes through exactly the same locked
 * transaction as a widget booking.
 */
export async function createBooking(input: NewBookingInput): Promise<ActionResult> {
  const who = await actor();

  const name = input.fullName.trim().replace(/\s+/g, ' ');
  const cut = name.indexOf(' ');
  const firstName = cut === -1 ? name : name.slice(0, cut);
  const lastName = cut === -1 ? '' : name.slice(cut + 1);
  const email = input.email.trim().toLowerCase().slice(0, 254);
  const phone = toE164(input.phone.trim());
  const days = Number(input.days);

  if (firstName.length < 2 || lastName.length < 1) {
    return { ok: false, error: 'Enter a first and last name.' };
  }
  if (!isEmail(email)) return { ok: false, error: 'Enter a valid email address.' };
  if (!phone) return { ok: false, error: 'Enter a 10-digit US mobile number.' };
  if (!isIsoDate(input.pickupDate)) return { ok: false, error: 'Pick a valid pickup date.' };
  // The same rules the screen showed: the office may book today and any length up
  // to 30 days, but not last week. Anything it does that a customer could not is
  // noted on the booking below, so Diana can see which rules were skipped.
  const verdict = checkBooking('office', input.pickupDate, days, bookingLimits());
  if (!verdict.ok) return { ok: false, error: verdict.error };

  const { createBookingWithTruck, NoTruckAvailableError } = await import('@/lib/availability');
  const { createPaperwork } = await import('@/lib/bookings');
  const { newReference } = await import('@/lib/tokens');

  let booking;
  try {
    booking = await createBookingWithTruck({
      pickupDate: input.pickupDate,
      reference: newReference(),
      firstName,
      lastName,
      email,
      phone,
      days,
      preferTruckId: input.truckId || null,
      mustUseTruck: Boolean(input.truckId),
      sourceUrl: 'crm',
    });
  } catch (err) {
    if (err instanceof NoTruckAvailableError) {
      // The default text is written for a customer who has just lost a race.
      // The office is looking at the availability line and needs the plain fact.
      const stale = err.message.startsWith('That date was taken');
      return { ok: false, error: stale ? 'No truck is free for those dates.' : err.message };
    }
    console.error('createBooking failed', err);
    return { ok: false, error: 'Could not create that booking.' };
  }

  const truckCode = booking.truck?.code ?? '?';
  const window = `${dateToIso(booking.pickupDate)} → ${dateToIso(booking.returnDate)}`;

  try {
    await createPaperwork(booking.id);
  } catch (err) {
    console.error('paperwork setup failed', err);
    return { ok: false, error: `Booking ${booking.reference} was created but its contract link was not. Open it and resend.` };
  }

  // No licence or insurance on a phone call. Flagging it puts the booking on
  // Needs attention until they turn up, rather than it being quietly forgotten.
  if (input.documentsLater) {
    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        needsReview: true,
        reviewNote: 'Licence and insurance not on file — booked by the office.',
      },
    });
  }

  await logEvent(
    booking.id,
    'booking_created',
    `Taken by the office · ${window} (${days} ${days === 1 ? 'day' : 'days'}) · Truck ${truckCode}` +
      (verdict.notes.length ? ` · ${verdict.notes.join(' ')}` : '') +
      (input.note.trim() ? ` — ${input.note.trim()}` : ''),
    who,
  );

  if (!input.sendContract) {
    await syncBookingToCalendar(booking.id);
    return done(`${booking.reference} created on Truck ${truckCode}. Nothing sent — use Resend when you are ready.`);
  }

  // The stage moves now so the board is honest the moment it reloads; the
  // sends themselves run after the response, because four GoHighLevel calls is
  // ten seconds nobody should sit through.
  await setStage(booking.id, Stage.CONTRACT_SENT, who, 'Rental agreement sent');

  const id = booking.id;
  after(async () => {
    try {
      await notify(id, 'booking_received');
      await notify(id, 'contract_to_sign');
      await notifyStaff(id, 'booking_received');
      await syncBookingToCalendar(id);
    } catch (err) {
      console.error('notify failed', err);
      await logEvent(id, 'notify_failed', String(err), 'system');
    }
  });

  return done(`${booking.reference} created on Truck ${truckCode}. The contract link is on its way to ${firstName}.`);
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
        template: {
          in: [
            'pickup_morning',
            'pickup_reminder',
            'return_day',
            'pickup_no_show_check',
            'overdue',
            'staff_overdue',
          ],
        },
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
    await notifyStaff(bookingId, 'dates_changed', { detail: reason || null }, { force: true });
    // `from` is what makes this a move: the days it no longer covers get cleared.
    await syncBookingToCalendar(bookingId, res.from);

    return done(`Moved to ${res.to.start} – ${res.to.end}. The renter has been told.`);
  } catch (err) {
    if (err instanceof NoTruckAvailableError) return { ok: false, error: err.message };
    console.error('changeDates failed', err);
    return { ok: false, error: 'Could not move that booking.' };
  }
}

// ---------------------------------------------------------------- approvals

export async function approveContractAction(contractId: string, approverId?: string): Promise<ActionResult> {
  await actor();
  try {
    const { approveContract } = await import('@/lib/approvals');
    const r = await approveContract(contractId, approverId);
    if (r.alreadySigned) return { ok: true, message: 'Already signed.' };
    return done(r.confirmed ? 'Signed. The renter has been confirmed.' : 'Signed. Still waiting on another signature.');
  } catch (err) {
    const { ApprovalError } = await import('@/lib/approvals');
    if (err instanceof ApprovalError) return { ok: false, error: err.message };
    console.error('approveContract failed', err);
    return { ok: false, error: 'Could not sign that.' };
  }
}

export async function approveChecklistAction(checklistId: string, approverId?: string): Promise<ActionResult> {
  await actor();
  try {
    const { approveChecklist } = await import('@/lib/approvals');
    const r = await approveChecklist(checklistId, approverId);
    if (r.alreadySigned) return { ok: true, message: 'Already signed.' };
    return done('Signed off.');
  } catch (err) {
    const { ApprovalError } = await import('@/lib/approvals');
    if (err instanceof ApprovalError) return { ok: false, error: err.message };
    console.error('approveChecklist failed', err);
    return { ok: false, error: 'Could not sign that.' };
  }
}

// ---------------------------------------------------------------- message a renter

export type OfficePreviewResult = { ok: true; preview: Preview } | { ok: false; errors: string[] };

/** The shape of a message from the browser, checked, since a server action is a public endpoint. */
function officeInput(raw: unknown): OfficeMessageInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.text !== 'string' || typeof r.subject !== 'string') return null;
  if (typeof r.sms !== 'boolean' || typeof r.email !== 'boolean') return null;
  return { text: r.text, subject: r.subject, sms: r.sms, email: r.email };
}

async function prepareFor(bookingId: string, raw: unknown) {
  const input = officeInput(raw);
  if (!input) return { ok: false as const, errors: ['That message was not understood.'] };

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { firstName: true, lastName: true, email: true, phone: true, stage: true },
  });
  if (!booking) return { ok: false as const, errors: ['That booking no longer exists.'] };

  // Only texts to this renter's own number: the second driver's texts are logged
  // against the same booking and must not stand in for the renter's history.
  const history = await prisma.messageLog.findMany({
    where: { bookingId, channel: 'SMS', toAddress: booking.phone },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { channel: true, toAddress: true, status: true, error: true, createdAt: true, sentAt: true },
  });

  const restored = await prisma.bookingEvent.findFirst({
    where: { bookingId, type: 'texts_restored' },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });

  return prepareOfficeMessage(
    booking,
    input,
    // A message that was resent keeps its creation time, so when it went out is the better clock.
    history.map((m) => ({ channel: m.channel, to: m.toAddress, status: m.status, error: m.error, at: m.sentAt ?? m.createdAt })),
    restored?.createdAt ?? null,
  );
}

/** Shows exactly what would be sent, and to whom. Sends nothing. */
export async function previewOfficeMessage(bookingId: string, raw: unknown): Promise<OfficePreviewResult> {
  await actor();
  return prepareFor(bookingId, raw);
}

/** Sends it. Prepared again here, so the checks hold even if the browser skipped the preview. */
export async function sendOfficeMessage(bookingId: string, raw: unknown): Promise<ActionResult> {
  await actor();
  const prepared = await prepareFor(bookingId, raw);
  if (!prepared.ok) return { ok: false, error: prepared.errors.join(' ') };

  const { preview } = prepared;
  const { sendCustomMessage } = await import('@/lib/notify');
  const res = await sendCustomMessage(bookingId, {
    subject: preview.subject,
    text: preview.text,
    channels: preview.recipients.map((r) => (r.channel === 'SMS' ? MessageChannel.SMS : MessageChannel.EMAIL)),
  });

  const via = res.sent.map((c) => c.toLowerCase()).join(' and ');
  await logEvent(
    bookingId,
    'office_message',
    `Message sent by the office${via ? ` by ${via}` : ' (nothing went out)'}: “${preview.text.slice(0, 160)}”`,
    'ops',
  );

  if (res.sent.length === 0) {
    return { ok: false, error: `It did not go out. ${res.errors.join(' ') || 'No reason was given.'}` };
  }
  revalidatePath('/app');
  const failed = res.errors.length ? ` But: ${res.errors.join(' ')}` : '';
  return { ok: true, message: `Sent by ${via}.${failed}` };
}

// ---------------------------------------------------------------- recipients

/** The active main admins, in the shape the approval rules work with. */
async function currentApprovers(): Promise<Approver[]> {
  const admins = await prisma.notificationRecipient.findMany({
    where: { role: 'MAIN_ADMIN', active: true },
    select: { id: true, name: true, signatureData: true },
  });
  return admins.map((a) => ({ id: a.id, name: a.name, hasSignature: Boolean(a.signatureData) }));
}

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

  // Several people can be main admin. The limits: not more than a handful, and
  // never leave nobody who can sign.
  const activeAdmins = await currentApprovers();
  const becomesAdmin = input.role === 'MAIN_ADMIN' && input.active;
  const wasAdmin = Boolean(input.id) && activeAdmins.some((a) => a.id === input.id);
  const limit = becomesAdmin && !wasAdmin
    ? canAddMainAdmin(activeAdmins.length)
    : wasAdmin && !becomesAdmin
      ? canStopBeingMainAdmin(activeAdmins, input.id!)
      : null;
  if (limit) return { ok: false, error: limit };

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
    const blocked = canStopBeingMainAdmin(await currentApprovers(), id);
    if (blocked) return { ok: false, error: blocked };
  }

  await prisma.notificationRecipient.delete({ where: { id } });
  revalidatePath('/app/notifications');
  return { ok: true, message: `${r.name} removed from the list.` };
}
