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

export function renterNotice(kind: NoticeKind | false | undefined, stageBefore: string): NoticeTemplate | null {
  if (!kind || !BEFORE_COLLECTION.includes(stageBefore)) return null;
  return kind === 'released' ? 'booking_released' : 'booking_cancelled';
}
