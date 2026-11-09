import { MessageStatus, Prisma, Stage } from '@prisma/client';
import { prisma } from './db';
import { config } from './config';
import {
  IsoDate,
  addDays,
  dateToIso,
  earliestBookable,
  isoToDate,
  latestBookable,
  overlaps,
  rentalWindow,
  todayInOps,
} from './dates';
import { SLACK_CAP, chooseTruck, freeRun, maxDaysOn, withBuffer, type TruckHolds } from './booking-fit';
import { customerDefaultDays } from './booking-rules';
import { checkSwap } from './truck-swap';
import { OVERLAP_MESSAGE, isOverlapViolation } from './overlap-guard';

/** Stages that still hold a truck. A cancelled booking frees its dates. */
export const HOLDING_STAGES: Stage[] = [
  Stage.NEW_BOOKING,
  Stage.CONTRACT_SENT,
  Stage.ADDITIONAL_DRIVER,
  // Waiting on the main admin still holds the truck — the renter has signed
  // and is expecting it; only the paperwork is outstanding.
  Stage.AWAITING_APPROVAL,
  Stage.CONFIRMED,
  Stage.PICKUP_DAY,
  Stage.IN_USE,
  Stage.RETURNED,
];

export type DayAvailability = {
  date: IsoDate;
  /**
   * Trucks free for the whole house length. Kept for booking pages that were
   * loaded before customers could choose a length: they judge a date by this.
   */
  trucksFree: number;
  freeTruckIds: string[];
  /** The most days a customer could book from this date. 0 means the date is not offered. */
  maxDays: number;
};

type Hold = { truckId: string | null; blockStart: Date; blockEnd: Date };

/**
 * What a customer could book from each date in [from, to].
 *
 * A date is offered when at least one truck is free that day, even if it is
 * booked again two days later: the customer is then offered the days that fit
 * (1 or 2) rather than being shut out. `maxDays` says how many. Dates before
 * the earliest day customers may book, or after the furthest, offer nothing.
 *
 * Customers also leave `bufferDays` empty around other rentals (0 by default,
 * which means back to back). The office does not use this function.
 */
export async function getAvailability(from: IsoDate, to: IsoDate): Promise<DayAvailability[]> {
  const cap = Math.max(1, config.customerMaxDays);
  const buffer = Math.max(0, config.bufferDays);
  const houseDays = customerDefaultDays(cap, config.rentalBlockDays);

  // Pull anything that could touch a rental starting anywhere in the range.
  const rangeStart = isoToDate(addDays(from, -buffer));
  const rangeEnd = isoToDate(addDays(to, cap + buffer));

  const [trucks, bookings, blackouts] = await Promise.all([
    prisma.truck.findMany({ where: { active: true }, select: { id: true, code: true }, orderBy: { code: 'asc' } }),
    prisma.booking.findMany({
      where: {
        stage: { in: HOLDING_STAGES },
        truckId: { not: null },
        blockStart: { lte: rangeEnd },
        blockEnd: { gte: rangeStart },
      },
      select: { truckId: true, blockStart: true, blockEnd: true },
    }),
    prisma.blackoutDate.findMany({
      where: { startDate: { lte: rangeEnd }, endDate: { gte: rangeStart } },
      select: { truckId: true, startDate: true, endDate: true },
    }),
  ]);

  const holds: Hold[] = [
    ...bookings.map((b) => ({ truckId: b.truckId, blockStart: b.blockStart, blockEnd: b.blockEnd })),
    ...blackouts.map((b) => ({ truckId: b.truckId, blockStart: b.startDate, blockEnd: b.endDate })),
  ];

  const byTruck: TruckHolds[] = trucks.map((t) => ({ id: t.id, code: t.code, holds: [] }));
  for (const h of holds) {
    if (!h.truckId) continue;
    byTruck.find((t) => t.id === h.truckId)?.holds.push({ start: dateToIso(h.blockStart), end: dateToIso(h.blockEnd) });
  }

  const floor = earliestBookable();
  const ceiling = latestBookable();

  const out: DayAvailability[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (d < floor || d > ceiling) {
      out.push({ date: d, trucksFree: 0, freeTruckIds: [], maxDays: 0 });
      continue;
    }
    const free = byTruck.filter((t) => freeRun(withBuffer(t.holds, buffer), d, houseDays) >= houseDays).map((t) => t.id);
    out.push({ date: d, trucksFree: free.length, freeTruckIds: free, maxDays: maxDaysOn(byTruck, d, cap, buffer) });
  }
  return out;
}

/**
 * prisma.$transaction, except that a refusal from the database's overlap guard
 * becomes the same plain NoTruckAvailableError the app-level check raises. The
 * app checks under a lock first, so the guard only fires if something slipped
 * past — a path that forgot to ask, or two writers racing in a way the lock
 * did not cover. `message: null` keeps the customer-facing default wording.
 */
async function guardedTransaction<T>(
  run: (tx: Prisma.TransactionClient) => Promise<T>,
  options: { isolationLevel: Prisma.TransactionIsolationLevel; timeout: number },
  message: string | null = OVERLAP_MESSAGE,
): Promise<T> {
  try {
    return await prisma.$transaction(run, options);
  } catch (err) {
    if (isOverlapViolation(err)) throw new NoTruckAvailableError(message ?? undefined);
    throw err;
  }
}

export class NoTruckAvailableError extends Error {
  constructor(message = 'That date was taken while you were filling in the form. Please pick another.') {
    super(message);
    this.name = 'NoTruckAvailableError';
  }
}

/**
 * Pick a truck for `pickup` and create the booking, atomically.
 *
 * Two people submitting for the last truck in the same second is a real race:
 * both read "1 free", both write, and you find out on pickup morning. The
 * transaction takes a lock on the truck rows first (SELECT ... FOR UPDATE), so
 * the second request blocks, re-reads, and gets a clean error instead.
 */
export async function createBookingWithTruck(input: {
  pickupDate: IsoDate;
  reference: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  draftId?: string | null;
  sourceUrl?: string | null;
  preferTruckId?: string | null;
  /**
   * Length in days. The widget always takes the house default; the office needs
   * to honour a genuine two-day booking at the point of taking it, rather than
   * booking three and moving it afterwards.
   */
  days?: number;
  /** Fail rather than silently substituting another truck. */
  mustUseTruck?: boolean;
  /**
   * Empty days to leave around other rentals. Customers pass the setting; the
   * office passes nothing, so it can book straight through it.
   */
  buffer?: number;
}) {
  const w = rentalWindow(input.pickupDate, input.days ?? config.rentalBlockDays);

  return guardedTransaction(
    async (tx) => {
      // Serialise every concurrent booking attempt behind the same row locks.
      await tx.$queryRaw`SELECT id FROM trucks WHERE active = true ORDER BY code ASC FOR UPDATE`;

      const trucks = await tx.truck.findMany({
        where: { active: true },
        select: { id: true, code: true },
        orderBy: { code: 'asc' },
      });
      // Every truck switched off is a deliberate pause, not a missing setup, and
      // this is what a customer with the form already open will read.
      if (trucks.length === 0) throw new NoTruckAvailableError('We are not taking new bookings right now.');

      const start = isoToDate(w.blockStart);
      const end = isoToDate(w.blockEnd);
      const length = Math.max(1, input.days ?? config.rentalBlockDays);
      const buffer = Math.max(0, input.buffer ?? 0);

      // Look past the rental too, to tell which truck is the tighter fit.
      const lookFrom = isoToDate(addDays(w.blockStart, -buffer));
      const lookTo = isoToDate(addDays(w.blockEnd, SLACK_CAP + buffer));
      const ids = trucks.map((t) => t.id);

      const [bookings, blackouts] = await Promise.all([
        tx.booking.findMany({
          where: {
            stage: { in: HOLDING_STAGES },
            truckId: { in: ids },
            blockStart: { lte: lookTo },
            blockEnd: { gte: lookFrom },
          },
          select: { truckId: true, blockStart: true, blockEnd: true },
        }),
        tx.blackoutDate.findMany({
          where: { truckId: { in: ids }, startDate: { lte: lookTo }, endDate: { gte: lookFrom } },
          select: { truckId: true, startDate: true, endDate: true },
        }),
      ]);

      const holds: TruckHolds[] = trucks.map((t) => ({
        id: t.id,
        code: t.code,
        holds: [
          ...bookings.filter((b) => b.truckId === t.id).map((b) => ({ start: dateToIso(b.blockStart), end: dateToIso(b.blockEnd) })),
          ...blackouts.filter((b) => b.truckId === t.id).map((b) => ({ start: dateToIso(b.startDate), end: dateToIso(b.endDate) })),
        ],
      }));

      // An explicit choice is honoured if that truck is free; otherwise the tightest fit.
      const chosen = chooseTruck(holds, w.blockStart, length, buffer, input.preferTruckId);
      if (input.preferTruckId && input.mustUseTruck && chosen?.id !== input.preferTruckId) {
        // The office picked that truck on purpose. Quietly handing them the
        // other one is how somebody turns up expecting the big van.
        const code = trucks.find((t) => t.id === input.preferTruckId)?.code ?? '?';
        throw new NoTruckAvailableError(`Truck ${code} is not free for those dates.`);
      }
      if (!chosen) {
        // Nothing fits for that long. If something fits for less, say how much.
        const fit = maxDaysOn(holds, w.blockStart, length, buffer);
        if (fit > 0) {
          const some = fit === 1 ? '1 day is' : `${fit} days are`;
          const choose = fit === 1 ? '1 day' : `up to ${fit} days`;
          throw new NoTruckAvailableError(`Only ${some} free from that date. Please choose ${choose} or another date.`);
        }
        throw new NoTruckAvailableError();
      }

      return tx.booking.create({
        data: {
          reference: input.reference,
          stage: Stage.NEW_BOOKING,
          truckId: chosen.id,
          pickupDate: isoToDate(w.pickupDate),
          returnDate: isoToDate(w.returnDate),
          blockStart: start,
          blockEnd: end,
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          phone: input.phone,
          draftId: input.draftId ?? null,
          sourceUrl: input.sourceUrl ?? null,
        },
        include: { truck: true },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 },
    null,
  );
}

export class SwapNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SwapNotAllowedError';
  }
}

/**
 * Move an accepted booking onto the other truck.
 *
 * The rule — accepted, pickup not yet arrived, target switched on — is checked
 * here, inside the same locked transaction as the clash test, rather than only
 * behind the button. A stale screen or a second admin could otherwise move a
 * booking whose renter already holds the other truck's lockbox code.
 *
 * Returns the updated booking plus the truck it came from, so the caller can
 * say "A to B" without re-reading it.
 */
export async function reassignTruck(bookingId: string, truckId: string) {
  return guardedTransaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM trucks WHERE active = true ORDER BY code ASC FOR UPDATE`;
    // The booking row too. cancelBooking and setStage never take the truck lock,
    // so without this a swap that read CONFIRMED could commit just after a
    // cancel and tell the renter about a truck on a booking that no longer
    // exists. Locked BEFORE the read, so what we read is what we write against.
    await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${bookingId} FOR UPDATE`;

    const booking = await tx.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { truck: true },
    });

    const target = await tx.truck.findUnique({ where: { id: truckId } });
    if (!target) throw new NoTruckAvailableError('That truck does not exist.');

    // Has the pickup-day code started going out? Queued counts as well as sent:
    // a send already in flight is carrying the OLD truck's code.
    const codeSent =
      (await tx.messageLog.count({
        where: {
          bookingId,
          template: 'pickup_morning',
          recipientKey: 'renter',
          status: { in: [MessageStatus.QUEUED, MessageStatus.SENT] },
        },
      })) > 0;

    const verdict = checkSwap({
      stage: booking.stage,
      pickupDate: dateToIso(booking.pickupDate),
      today: todayInOps(),
      codeSent,
      currentTruckId: booking.truckId,
      target: { id: target.id, code: target.code, active: target.active },
    });
    if (!verdict.ok) throw new SwapNotAllowedError(verdict.reason);

    const clash = await tx.booking.findFirst({
      where: {
        id: { not: bookingId },
        truckId,
        stage: { in: HOLDING_STAGES },
        blockStart: { lte: booking.blockEnd },
        blockEnd: { gte: booking.blockStart },
      },
      select: { reference: true },
    });
    if (clash) throw new NoTruckAvailableError(`That truck is already out on those dates (${clash.reference}).`);

    const blackout = await tx.blackoutDate.findFirst({
      where: { truckId, startDate: { lte: booking.blockEnd }, endDate: { gte: booking.blockStart } },
    });
    if (blackout) throw new NoTruckAvailableError('That truck is blacked out for those dates.');

    const updated = await tx.booking.update({
      where: { id: bookingId },
      data: { truckId },
      include: { truck: true },
    });
    return { ...updated, previousTruckCode: booking.truck?.code ?? null };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 });
}


/**
 * Move a booking to new dates.
 *
 * Takes the same row lock as the original booking, so a move cannot collide
 * with another rental or a blackout that lands between the check and the write.
 *
 * `days` is explicit rather than always RENTAL_BLOCK_DAYS, because the office
 * needs to honour a genuine two-day exception without bending the default for
 * everyone.
 */
export async function rescheduleBooking(bookingId: string, newPickup: IsoDate, days: number) {
  const span = Math.max(1, Math.min(days, 30));

  return guardedTransaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM trucks WHERE active = true ORDER BY code ASC FOR UPDATE`;

    const booking = await tx.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { truck: true },
    });
    if (!booking.truckId) throw new NoTruckAvailableError('That booking has no truck assigned.');

    const blockStart = newPickup;
    const blockEnd = addDays(newPickup, span - 1);
    const start = isoToDate(blockStart);
    const end = isoToDate(blockEnd);

    const clash = await tx.booking.findFirst({
      where: {
        id: { not: bookingId },
        truckId: booking.truckId,
        stage: { in: HOLDING_STAGES },
        blockStart: { lte: end },
        blockEnd: { gte: start },
      },
      select: { reference: true, firstName: true, lastName: true },
    });
    if (clash) {
      throw new NoTruckAvailableError(
        `Truck ${booking.truck?.code} is already out then — ${clash.firstName} ${clash.lastName} (${clash.reference}).`,
      );
    }

    const blackout = await tx.blackoutDate.findFirst({
      where: { truckId: booking.truckId, startDate: { lte: end }, endDate: { gte: start } },
      select: { reason: true },
    });
    if (blackout) {
      throw new NoTruckAvailableError(`Truck ${booking.truck?.code} is blacked out then (${blackout.reason}).`);
    }

    const updated = await tx.booking.update({
      where: { id: bookingId },
      data: {
        pickupDate: start,
        blockStart: start,
        returnDate: end,
        blockEnd: end,
        // A move to the future un-flags a truck that was only late for the old date.
        overdue: false,
      },
      include: { truck: true },
    });

    return {
      booking: updated,
      from: { start: dateToIso(booking.blockStart), end: dateToIso(booking.blockEnd) },
      to: { start: blockStart, end: blockEnd },
    };
    // The default interactive-transaction timeout is five seconds, which a
    // slow connection blows through while holding the truck row lock.
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 });
}

/**
 * What is actually free for a window, and who is holding whatever is not.
 *
 * This is the read-only twin of the check inside `createBookingWithTruck`, used
 * to tell the office what they are about to run into *before* they submit.
 * It deliberately does not lock: it is a preview, and the transaction remains
 * the only thing that decides.
 */
export async function freeTrucksFor(
  pickup: IsoDate,
  days: number,
): Promise<{
  free: Array<{ id: string; code: string }>;
  taken: Array<{ code: string; reason: string }>;
  window: { start: IsoDate; end: IsoDate };
}> {
  const w = rentalWindow(pickup, Math.max(1, Math.min(days, 30)));
  const start = isoToDate(w.blockStart);
  const end = isoToDate(w.blockEnd);

  const [trucks, bookings, blackouts] = await Promise.all([
    prisma.truck.findMany({ where: { active: true }, select: { id: true, code: true }, orderBy: { code: 'asc' } }),
    prisma.booking.findMany({
      where: {
        stage: { in: HOLDING_STAGES },
        truckId: { not: null },
        blockStart: { lte: end },
        blockEnd: { gte: start },
      },
      select: { truckId: true, reference: true, firstName: true, lastName: true },
    }),
    prisma.blackoutDate.findMany({
      where: { startDate: { lte: end }, endDate: { gte: start } },
      select: { truckId: true, reason: true },
    }),
  ]);

  const why = new Map<string, string>();
  for (const b of bookings) {
    if (b.truckId && !why.has(b.truckId)) {
      why.set(b.truckId, `${b.firstName} ${b.lastName}`.trim() + ` (${b.reference})`);
    }
  }
  for (const b of blackouts) if (!why.has(b.truckId)) why.set(b.truckId, b.reason || 'blocked');

  return {
    free: trucks.filter((t) => !why.has(t.id)),
    taken: trucks.filter((t) => why.has(t.id)).map((t) => ({ code: t.code, reason: why.get(t.id)! })),
    window: { start: w.blockStart, end: w.blockEnd },
  };
}
