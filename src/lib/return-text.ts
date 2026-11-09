import type { IsoDate } from './dates';

/**
 * Whether the "due back today" text should go out now.
 *
 * For a rental of two or more days it goes out once, at the return-text hour,
 * on the day the truck is due back. For a ONE-day rental the pickup day and the
 * return day are the same day, so that rule would send "here is your lockbox
 * code" at 6 AM and "due back today" at 7 AM. Instead a one-day rental waits
 * until the renter actually has the truck (their pickup photos are in) and
 * then goes out from midday on.
 *
 * Pure, so the rule can be tested without a clock or a database. Every send is
 * still deduplicated in the database, so asking again on a later hour is safe.
 */

/** The earliest hour a one-day rental is told it is due back. */
export const SAME_DAY_RETURN_HOUR = 12;

export type ReturnFacts = {
  pickupDate: IsoDate;
  returnDate: IsoDate;
  stage: string;
  today: IsoDate;
  hour: number;
  /** The return-text hour from Settings. */
  returnHour: number;
  /** A manual run: ignore the hour so it can be tested at any time. */
  force?: boolean;
};

export function returnTextDue(f: ReturnFacts): boolean {
  if (f.returnDate !== f.today) return false;
  if (f.stage !== 'IN_USE' && f.stage !== 'PICKUP_DAY') return false;

  const oneDay = f.pickupDate === f.returnDate;
  if (!oneDay) return f.force ? true : f.hour === f.returnHour;

  // A one-day rental: only once they have the truck.
  if (f.stage !== 'IN_USE') return false;
  return f.force ? true : f.hour >= Math.max(SAME_DAY_RETURN_HOUR, f.returnHour);
}
