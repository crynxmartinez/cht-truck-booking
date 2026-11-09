import { addDays, type IsoDate } from './dates';

/**
 * How long a truck is free for, and which truck to give someone.
 *
 * Pure: no database and no clock, so every rule can be tested by itself and
 * the booking page, the office screen and the booking itself all agree.
 *
 * A truck is "held" for a run of days (a booking or a blackout). It is free
 * again the day after a hold ends: there is no rest day between rentals,
 * unless the customer-side buffer says otherwise.
 */

/** An inclusive run of days a truck is held. */
export type Interval = { start: IsoDate; end: IsoDate };

export type TruckHolds = { id: string; code: string; holds: Interval[] };

/** How far ahead to look when judging how "tight" a fit is. Beyond this, trucks count as equally open. */
export const SLACK_CAP = 60;

/**
 * Widen every hold by `days` on each side. This is the empty time a customer
 * must leave around somebody else's rental. The office does not use it.
 */
export function withBuffer(holds: Interval[], days: number): Interval[] {
  if (days <= 0) return holds;
  return holds.map((h) => ({ start: addDays(h.start, -days), end: addDays(h.end, days) }));
}

/**
 * Days in a row, starting on `date`, that nothing holds the truck, up to `cap`.
 * Zero when the day itself is taken.
 */
export function freeRun(holds: Interval[], date: IsoDate, cap: number): number {
  let run = 0;
  for (let i = 0; i < cap; i += 1) {
    const d = addDays(date, i);
    if (holds.some((h) => h.start <= d && d <= h.end)) break;
    run += 1;
  }
  return run;
}

/**
 * The most days a customer could book starting on `date`: the best any one
 * truck can do, up to the cap. Zero means the date is not offered at all.
 */
export function maxDaysOn(trucks: TruckHolds[], date: IsoDate, cap: number, buffer: number): number {
  let best = 0;
  for (const t of trucks) {
    best = Math.max(best, freeRun(withBuffer(t.holds, buffer), date, cap));
    if (best >= cap) break;
  }
  return best;
}

/**
 * Pick the truck for a booking of `days` starting on `date`, or null if none
 * is free for that long.
 *
 * A requested truck is honoured if it is free. Otherwise the tightest fit
 * wins: the truck with the least free time left after the rental, so the one
 * with a long open stretch stays available for a longer booking. Ties go to
 * the first truck in the order given.
 */
export function chooseTruck(
  trucks: TruckHolds[],
  date: IsoDate,
  days: number,
  buffer: number,
  preferTruckId: string | null | undefined,
): { id: string; code: string } | null {
  const candidates = trucks
    .map((t) => ({ t, run: freeRun(withBuffer(t.holds, buffer), date, Math.max(days, SLACK_CAP)) }))
    .filter((c) => c.run >= days);

  if (candidates.length === 0) return null;

  const asked = preferTruckId ? candidates.find((c) => c.t.id === preferTruckId) : undefined;
  if (asked) return { id: asked.t.id, code: asked.t.code };

  // Array.prototype.sort is stable, so equal fits keep the order they came in.
  const tightest = [...candidates].sort((a, b) => a.run - b.run)[0];
  return { id: tightest.t.id, code: tightest.t.code };
}
