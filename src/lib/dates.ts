import { config } from './config';

/**
 * Calendar days are stored as Postgres DATE, which Prisma hands back as a JS
 * Date pinned to UTC midnight. Everything here works in that space and only
 * touches the ops timezone when it needs to know what "today" or "what hour is
 * it in Murrieta" means. Keeping those two ideas separate is what stops the
 * 6 AM text drifting an hour every daylight-saving change.
 */

export type IsoDate = string; // YYYY-MM-DD

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(v: unknown): v is IsoDate {
  return typeof v === 'string' && ISO_RE.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'));
}

/** Today's calendar date at the pickup yard, not on the server. */
export function todayInOps(now: Date = new Date()): IsoDate {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Hour of the day (0-23) at the pickup yard. */
export function hourInOps(now: Date = new Date()): number {
  const h = new Intl.DateTimeFormat('en-US', {
    timeZone: config.timeZone,
    hour: '2-digit',
    hour12: false,
  }).format(now);
  return Number(h) % 24;
}

/** YYYY-MM-DD -> Date at UTC midnight, which is what @db.Date expects. */
export function isoToDate(iso: IsoDate): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/** A @db.Date value (or anything) -> YYYY-MM-DD. */
export function dateToIso(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  const d = isoToDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return dateToIso(d);
}

export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((isoToDate(b).getTime() - isoToDate(a).getTime()) / 86_400_000);
}

export function compareIso(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Inclusive list of dates from `from` to `to`. */
export function eachDay(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * The window a single booking occupies.
 *
 * With RENTAL_BLOCK_DAYS = 3 and a Monday pickup: the renter has Monday and
 * Tuesday, brings it back Wednesday, and the truck goes out again Thursday.
 * blockEnd is inclusive.
 */
export function rentalWindow(pickup: IsoDate, blockDays = config.rentalBlockDays) {
  const span = Math.max(1, blockDays);
  const blockEnd = addDays(pickup, span - 1);
  return {
    pickupDate: pickup,
    returnDate: blockEnd,
    blockStart: pickup,
    blockEnd,
  };
}

/** Two inclusive ranges overlap. */
export function overlaps(aStart: IsoDate, aEnd: IsoDate, bStart: IsoDate, bEnd: IsoDate): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/** Earliest date the public may book. */
export function earliestBookable(now: Date = new Date()): IsoDate {
  return addDays(todayInOps(now), config.minLeadDays);
}

/** Last date the calendar offers. */
export function latestBookable(now: Date = new Date()): IsoDate {
  const today = todayInOps(now);
  const [y, m] = today.split('-').map(Number);
  // Last day of the month `maxMonthsAhead` from now.
  const d = new Date(Date.UTC(y, m - 1 + config.maxMonthsAhead + 1, 0));
  return dateToIso(d);
}

// ---------------------------------------------------------------- formatting

export function formatLong(iso: IsoDate): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(isoToDate(iso));
}

export function formatMedium(iso: IsoDate): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(isoToDate(iso));
}

export function formatShort(iso: IsoDate): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
  }).format(isoToDate(iso));
}

/** Timestamps in the CRM, shown in Murrieta time so it matches the office clock. */
export function formatStamp(d: Date | null | undefined): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: config.timeZone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}
