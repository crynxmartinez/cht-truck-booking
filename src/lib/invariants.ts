/**
 * Things that must always be true about the bookings, stated as pure checks.
 *
 * Kept free of the database and of Google so the same rules can run in a test,
 * in the `check:invariants` script against the live data, and anywhere else
 * someone wants to ask "is the system actually consistent right now?".
 */

import { GUARDED_STAGES } from './overlap-guard';

export type HoldRow = {
  id: string;
  reference: string;
  truckId: string | null;
  /** YYYY-MM-DD, inclusive */
  blockStart: string;
  /** YYYY-MM-DD, inclusive */
  blockEnd: string;
  stage: string;
};

export type ExpectedEvent = { id: string; summary: string; colorId: string; status: string };
export type ActualEvent = { id: string; summary: string; colorId?: string; status?: string };

/**
 * Stages in which a booking holds its truck. Taken from the same list the
 * database guard uses, so the audit and the guard cannot disagree; a test
 * pins that list to HOLDING_STAGES in availability.ts.
 */
const HOLDING = new Set<string>(GUARDED_STAGES);

/** Our own calendar events all carry this id prefix; anything else was added by hand. */
export const EVENT_ID_PREFIX = 'cht';

/** Every pair of truck-holding bookings that share a day on the same truck. */
export function findOverlaps(rows: HoldRow[]): Array<[HoldRow, HoldRow]> {
  const holding = rows.filter((r) => r.truckId !== null && HOLDING.has(r.stage));
  const found: Array<[HoldRow, HoldRow]> = [];

  for (let i = 0; i < holding.length; i++) {
    for (let j = i + 1; j < holding.length; j++) {
      const a = holding[i];
      const b = holding[j];
      if (a.truckId !== b.truckId) continue;
      // ISO dates compare correctly as strings.
      if (a.blockStart <= b.blockEnd && b.blockStart <= a.blockEnd) found.push([a, b]);
    }
  }
  return found;
}

/**
 * Does a message carry some OTHER truck's lockbox code?
 *
 * Each truck has its own code, so a renter holding the wrong one is standing
 * at a lockbox that will not open. Returns false when it cannot tell — no code
 * in the text, nothing to confuse it with, or two trucks sharing one code.
 */
export function wrongTruckCode(body: string, ownCode: string | null, otherCodes: string[]): boolean {
  const others = otherCodes.filter((c) => c && c !== ownCode);
  if (others.length === 0) return false;
  if (ownCode && body.includes(ownCode)) return false;
  return others.some((c) => body.includes(c));
}

/**
 * Compare the calendar we intend with the calendar Google actually holds.
 *
 * `known` lists event ids that no longer need to exist but are not strays
 * either — a finished booking's events are kept on purpose, as history.
 */
export function diffCalendar(expected: ExpectedEvent[], actual: ActualEvent[], known: string[] = []) {
  const byId = new Map(actual.map((a) => [a.id, a]));
  const want = new Set([...expected.map((e) => e.id), ...known]);

  const missing: string[] = [];
  const wrong: Array<{ id: string; expected: ExpectedEvent; actual: ActualEvent }> = [];

  for (const e of expected) {
    const a = byId.get(e.id);
    if (!a) {
      missing.push(e.id);
    } else if (
      a.summary !== e.summary ||
      a.colorId !== e.colorId ||
      // Google omits the status on a plain confirmed event.
      (a.status ?? 'confirmed') !== e.status
    ) {
      wrong.push({ id: e.id, expected: e, actual: a });
    }
  }

  const orphans = actual
    .filter((a) => a.id.startsWith(EVENT_ID_PREFIX) && !want.has(a.id))
    .map((a) => a.id);

  return { missing, wrong, orphans };
}
