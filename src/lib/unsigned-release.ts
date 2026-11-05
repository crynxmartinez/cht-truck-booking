import type { Prisma, Stage } from '@prisma/client';

/**
 * Which unsigned bookings the daily sweep lets go.
 *
 * Still waiting on a signature (the renter's, or their second driver's), booked
 * longer ago than the cut-off, and not reopened since: when the office puts a
 * booking back, the clock starts again, or it would be released again at the
 * next sweep and the renter told "released" straight after being told they can
 * have the truck back.
 */
export const UNSIGNED_STAGES: Stage[] = ['CONTRACT_SENT', 'ADDITIONAL_DRIVER'];

export function unsignedReleaseWhere(cutoff: Date): Prisma.BookingWhereInput {
  return {
    stage: { in: UNSIGNED_STAGES },
    createdAt: { lte: cutoff },
    NOT: { events: { some: { type: 'reopened', createdAt: { gt: cutoff } } } },
  };
}
