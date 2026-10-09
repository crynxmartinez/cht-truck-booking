/**
 * What to tell a renter on the day they collect the truck, and when.
 *
 * Pure on purpose — no database, no clock, no environment — so every rule can
 * be pinned by a test. The caller supplies what has already been sent and what
 * time it is at the yard, and gets back the one message that is due, if any.
 *
 * Three messages, because this is the one text where a miss is expensive: a
 * renter standing at a locked truck with no code. The first carries the code.
 * The next two only go out while the pickup checklist is still outstanding, so
 * anyone who has already collected the truck is never nagged.
 */

export type PickupTemplate = 'pickup_morning' | 'pickup_reminder' | 'pickup_no_show_check';

export type PickupSchedule = {
  /** The code goes out from this hour on pickup day. */
  morningHour: number;
  reminderHour: number;
  finalHour: number;
  /** Reminders stop after this hour. The code itself never expires. */
  lastHour: number;
  /** Minimum gap between any two pickup messages. */
  minGapHours: number;
};

export const DEFAULT_SCHEDULE: PickupSchedule = {
  morningHour: 6,
  reminderHour: 10,
  finalHour: 14,
  lastHour: 19,
  minGapHours: 3,
};

export type PickupBooking = {
  stage: string;
  /** YYYY-MM-DD */
  pickupDate: string;
  /** The renter has finished the pickup checklist, so they have the truck. */
  pickupSubmitted: boolean;
  /** When each pickup message went out, if it has. */
  sent: Partial<Record<PickupTemplate, Date>>;
};

export type Clock = {
  /** Today's date at the yard, YYYY-MM-DD. */
  today: string;
  /** Hour of day at the yard, 0-23. */
  hour: number;
  now: Date;
};

const HOUR_MS = 3_600_000;

/**
 * Slack on the minimum gap. A send is stamped when it FINISHES, after a few
 * seconds of provider latency, while the next tick is judged from the moment
 * it starts. Without this, a reminder due at exactly three hours slips a whole
 * hour because the previous message took a minute to leave.
 */
const GAP_TOLERANCE_MS = 10 * 60_000;

/** Stages in which the renter has not yet taken the truck. */
const AWAITING_COLLECTION = new Set(['CONFIRMED', 'PICKUP_DAY']);

export function nextPickupMessage(
  booking: PickupBooking,
  clock: Clock,
  schedule: PickupSchedule = DEFAULT_SCHEDULE,
): PickupTemplate | null {
  if (booking.pickupDate !== clock.today) return null;
  if (!AWAITING_COLLECTION.has(booking.stage)) return null;

  const { sent } = booking;

  // The code. Any hour from the morning on, not only the morning hour: a late
  // approval must still release it, which the old 6 AM-only job could not do.
  if (!sent.pickup_morning) {
    return booking.stage === 'CONFIRMED' && clock.hour >= schedule.morningHour ? 'pickup_morning' : null;
  }

  // Everything after the code is a reminder, and only matters until they have
  // the truck and have done the checklist.
  if (booking.pickupSubmitted) return null;
  if (clock.hour > schedule.lastHour) return null;

  const previous = sent.pickup_reminder ?? sent.pickup_morning;
  const gapMs = clock.now.getTime() - previous.getTime();
  if (gapMs < schedule.minGapHours * HOUR_MS - GAP_TOLERANCE_MS) return null;

  if (!sent.pickup_reminder) {
    return clock.hour >= schedule.reminderHour ? 'pickup_reminder' : null;
  }
  if (!sent.pickup_no_show_check) {
    return clock.hour >= schedule.finalHour ? 'pickup_no_show_check' : null;
  }
  return null;
}
