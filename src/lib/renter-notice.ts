/**
 * Whether, and which, message tells a renter their booking is off.
 *
 * 'cancelled' is the office cancelling (and choosing to tell them);
 * 'released' is the system letting the truck go because the agreement was
 * never signed. Nothing is sent once the renter has the truck or the rental is
 * over: "your rental is cancelled" to someone driving it would be wrong, and
 * alarming. Pure, so the rule can be tested without a database.
 */
export type NoticeKind = 'cancelled' | 'released';
export type NoticeTemplate = 'booking_cancelled' | 'booking_released';

const BEFORE_COLLECTION = ['NEW_BOOKING', 'CONTRACT_SENT', 'ADDITIONAL_DRIVER', 'AWAITING_APPROVAL', 'CONFIRMED', 'PICKUP_DAY'];

/** Stages where something still waits on a signature from the renter or their second driver. */
const UNSIGNED = ['NEW_BOOKING', 'CONTRACT_SENT', 'ADDITIONAL_DRIVER'];

export function renterNotice(kind: NoticeKind | false | undefined, stageBefore: string): NoticeTemplate | null {
  if (!kind || !BEFORE_COLLECTION.includes(stageBefore)) return null;
  if (kind === 'released') return UNSIGNED.includes(stageBefore) ? 'booking_released' : null;
  return 'booking_cancelled';
}
