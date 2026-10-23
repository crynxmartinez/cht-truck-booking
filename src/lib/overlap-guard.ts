/**
 * A database-level guarantee that one truck cannot be held by two bookings on
 * the same day.
 *
 * The app already checks this under a row lock, but every check lives in code
 * that someone can bypass without meaning to — reopening a cancelled booking
 * and moving a card by hand both used to skip it entirely. A Postgres
 * exclusion constraint refuses the write no matter which path made it, so the
 * guarantee does not depend on every future path remembering to ask.
 *
 * Prisma cannot express exclusion constraints, so this is applied with
 * `scripts/apply-overlap-guard.ts` rather than `prisma db push`.
 */

export const OVERLAP_CONSTRAINT = 'bookings_no_overlap';

/**
 * The stages that hold a truck. Must equal HOLDING_STAGES in availability.ts —
 * a test pins the two together so they cannot drift.
 */
export const GUARDED_STAGES = [
  'NEW_BOOKING',
  'CONTRACT_SENT',
  'ADDITIONAL_DRIVER',
  'AWAITING_APPROVAL',
  'CONFIRMED',
  'PICKUP_DAY',
  'IN_USE',
  'RETURNED',
] as const;

const stageList = GUARDED_STAGES.map((s) => `'${s}'`).join(', ');

/**
 * `stage` is compared as an enum, not cast to text: a text cast is only STABLE,
 * and Postgres refuses anything but IMMUTABLE inside a constraint predicate.
 */
export const OVERLAP_GUARD_SQL = `ALTER TABLE bookings ADD CONSTRAINT ${OVERLAP_CONSTRAINT}
  EXCLUDE USING gist (
    "truckId" WITH =,
    daterange("blockStart", "blockEnd", '[]') WITH &&
  ) WHERE ("truckId" IS NOT NULL AND stage IN (${stageList}))`;

/** Postgres SQLSTATE for an exclusion-constraint violation. */
const EXCLUSION_VIOLATION = '23P01';

/** Did this error come from the overlap guard refusing a write? */
export function isOverlapViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; meta?: { code?: unknown }; message?: unknown };

  if (e.code === EXCLUSION_VIOLATION || e.meta?.code === EXCLUSION_VIOLATION) return true;

  const message = typeof e.message === 'string' ? e.message : '';
  return message.includes(OVERLAP_CONSTRAINT) || message.includes('violates exclusion constraint');
}

/** What to tell a person when the guard refuses a write. */
export const OVERLAP_MESSAGE = 'That truck is already booked on those dates.';
