import { Prisma, Stage } from '@prisma/client';
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
} from './dates';

/** Stages that still hold a truck. A cancelled booking frees its dates. */
export const HOLDING_STAGES: Stage[] = [
  Stage.NEW_BOOKING,
  Stage.CONTRACT_SENT,
  Stage.ADDITIONAL_DRIVER,
  Stage.CONFIRMED,
  Stage.PICKUP_DAY,
  Stage.IN_USE,
  Stage.RETURNED,
];

export type DayAvailability = {
  date: IsoDate;
  trucksFree: number;
  freeTruckIds: string[];
};

type Hold = { truckId: string | null; blockStart: Date; blockEnd: Date };

/**
 * Which trucks could start a rental on each date in [from, to].
 *
 * A date is offered when at least one active truck has no booking and no
 * blackout overlapping the *whole* window that would start there — not merely
 * the day itself. Booking a Monday when Tuesday is already taken would strand
 * the renter mid-rental, so those dates are closed too.
 */
export async function getAvailability(from: IsoDate, to: IsoDate): Promise<DayAvailability[]> {
  const span = config.rentalBlockDays;

  // Pull anything that could overlap a window starting anywhere in the range.
  const rangeStart = isoToDate(addDays(from, -span));
  const rangeEnd = isoToDate(addDays(to, span));

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

  const byTruck = new Map<string, Array<{ start: IsoDate; end: IsoDate }>>();
  for (const t of trucks) byTruck.set(t.id, []);
  for (const h of holds) {
    if (!h.truckId) continue;
    byTruck.get(h.truckId)?.push({ start: dateToIso(h.blockStart), end: dateToIso(h.blockEnd) });
  }

  const floor = earliestBookable();
  const ceiling = latestBookable();

  const out: DayAvailability[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (d < floor || d > ceiling) {
      out.push({ date: d, trucksFree: 0, freeTruckIds: [] });
      continue;
    }
    const w = rentalWindow(d);
    const free = trucks
      .filter((t) => !(byTruck.get(t.id) ?? []).some((h) => overlaps(w.blockStart, w.blockEnd, h.start, h.end)))
      .map((t) => t.id);
    out.push({ date: d, trucksFree: free.length, freeTruckIds: free });
  }
  return out;
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
}) {
  const w = rentalWindow(input.pickupDate);

  return prisma.$transaction(
    async (tx) => {
      // Serialise every concurrent booking attempt behind the same row locks.
      await tx.$queryRaw`SELECT id FROM trucks WHERE active = true ORDER BY code ASC FOR UPDATE`;

      const trucks = await tx.truck.findMany({
        where: { active: true },
        select: { id: true, code: true },
        orderBy: { code: 'asc' },
      });
      if (trucks.length === 0) throw new NoTruckAvailableError('No trucks are set up yet.');

      const start = isoToDate(w.blockStart);
      const end = isoToDate(w.blockEnd);

      const [clashingBookings, clashingBlackouts] = await Promise.all([
        tx.booking.findMany({
          where: {
            stage: { in: HOLDING_STAGES },
            truckId: { in: trucks.map((t) => t.id) },
            blockStart: { lte: end },
            blockEnd: { gte: start },
          },
          select: { truckId: true },
        }),
        tx.blackoutDate.findMany({
          where: {
            truckId: { in: trucks.map((t) => t.id) },
            startDate: { lte: end },
            endDate: { gte: start },
          },
          select: { truckId: true },
        }),
      ]);

      const taken = new Set<string>();
      for (const b of clashingBookings) if (b.truckId) taken.add(b.truckId);
      for (const b of clashingBlackouts) taken.add(b.truckId);

      const free = trucks.filter((t) => !taken.has(t.id));
      if (free.length === 0) throw new NoTruckAvailableError();

      // Honour an explicit choice if it is still free, otherwise A before B.
      const chosen = (input.preferTruckId && free.find((t) => t.id === input.preferTruckId)) || free[0];

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
  );
}

/**
 * Move a confirmed booking onto the other truck. Used from the CRM when the
 * office wants B instead of A. Refuses if the target is not actually free.
 */
export async function reassignTruck(bookingId: string, truckId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM trucks WHERE active = true ORDER BY code ASC FOR UPDATE`;

    const booking = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });

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

    return tx.booking.update({
      where: { id: bookingId },
      data: { truckId },
      include: { truck: true },
    });
  });
}
