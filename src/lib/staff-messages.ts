import { config } from './config';
import { formatMedium } from './dates';

/**
 * Internal alerts. Deliberately not written like the customer copy — these are
 * read at a glance on a phone, so the truck, the date and the name come first
 * and there is no greeting to scroll past.
 *
 * Kept separate from messages.ts so nobody edits a customer template and
 * accidentally changes what the office sees, or the reverse.
 */

export type StaffEvent =
  | 'booking_received'
  | 'additional_driver_invited'
  | 'confirmed'
  | 'picked_up'
  | 'returned'
  | 'reschedule_requested'
  | 'overdue'
  | 'cancelled';

export type StaffContext = {
  reference: string;
  renterName: string;
  renterEmail: string;
  renterPhone: string;
  truckCode: string | null;
  pickupDate: string;
  returnDate: string;
  additionalDriverName?: string | null;
  detail?: string | null;
  reportedTime?: string | null;
};

export type StaffRendered = { subject: string; email: string; sms: string };

/** Priority marker so a glanced text says whether it needs acting on. */
const URGENT: StaffEvent[] = ['overdue', 'reschedule_requested'];

export function isUrgent(event: StaffEvent): boolean {
  return URGENT.includes(event);
}

export function renderStaff(event: StaffEvent, c: StaffContext): StaffRendered {
  const truck = c.truckCode ? `Truck ${c.truckCode}` : 'no truck yet';
  const pickup = formatMedium(c.pickupDate);
  const back = formatMedium(c.returnDate);
  const who = c.renterName;
  const board = `${config.appUrl}/app`;

  // Every email ends with the same block, so the details are always in the
  // same place regardless of which event fired.
  const facts = [
    ``,
    `Renter:   ${who}`,
    `Contact:  ${c.renterEmail} · ${c.renterPhone}`,
    `Truck:    ${c.truckCode ?? '—'}`,
    `Pickup:   ${pickup}`,
    `Due back: ${back}`,
    `Ref:      ${c.reference}`,
    ``,
    board,
  ].join('\n');

  const wrap = (subject: string, headline: string, sms: string): StaffRendered => ({
    subject,
    email: `${headline}\n${facts}`,
    sms,
  });

  switch (event) {
    case 'booking_received':
      return wrap(
        `New booking — ${who}, ${truck}, ${pickup}`,
        `${who} just booked ${truck} for ${pickup}. Licence and insurance are on file, and the rental agreement has gone out automatically.`,
        `NEW BOOKING · ${who} · ${truck} · ${pickup}. Agreement sent. ${board}`,
      );


    case 'additional_driver_invited':
      return wrap(
        `Second driver named — ${who}, ${pickup}`,
        `${who} named ${c.additionalDriverName ?? 'a second driver'} on the ${pickup} rental. Their own agreement has been sent to them directly. The confirmation is on hold until they sign.`,
        `2ND DRIVER · ${c.additionalDriverName ?? 'unnamed'} on ${who}'s ${pickup} rental. Agreement sent, waiting on signature.`,
      );


    case 'confirmed':
      return wrap(
        `Confirmed — ${who}, ${truck}, ${pickup}`,
        `All agreements are in${c.additionalDriverName ? `, including ${c.additionalDriverName} as second driver` : ''}. ${truck} is locked to ${who} for ${pickup}. They get the lockbox code at 6 AM that morning.`,
        `CONFIRMED · ${who} · ${truck} · ${pickup}${c.additionalDriverName ? ` (+${c.additionalDriverName})` : ''}. Lockbox code 6 AM.`,
      );

    case 'picked_up':
      return wrap(
        `Picked up — ${who}, ${truck}`,
        `${who} collected ${truck}${c.reportedTime ? ` at ${c.reportedTime}` : ''} and submitted the pickup photos. Due back ${back}.`,
        `PICKED UP · ${who} · ${truck}${c.reportedTime ? ` · ${c.reportedTime}` : ''}. Due back ${back}.`,
      );

    case 'returned':
      return wrap(
        `Returned — ${who}, ${truck}`,
        `${truck} is back${c.reportedTime ? ` (${c.reportedTime})` : ''} and the return photos are in.${c.detail ? `\n\nThey left a note: "${c.detail}"` : ''}\n\nGive it a look and close the booking when you are happy.`,
        `RETURNED · ${who} · ${truck}${c.reportedTime ? ` · ${c.reportedTime}` : ''}${c.detail ? ' · NOTE LEFT' : ''}. Needs your once-over.`,
      );

    case 'reschedule_requested':
      return wrap(
        `Reschedule asked — ${who}, ${pickup}`,
        `${who} replied asking to reschedule the ${pickup} rental.${c.detail ? `\n\nThey said: "${c.detail}"` : ''}\n\nNothing has been changed or released — that is your call.`,
        `RESCHEDULE · ${who} · ${pickup}. Nothing changed yet, needs you.`,
      );

    case 'overdue':
      return wrap(
        `OVERDUE — ${truck}, ${who}`,
        `${truck} was due back ${back} and has not been returned. ${who} has been sent a reminder.\n\nContract clause 3 gives three days before it counts as an unauthorised taking.`,
        `OVERDUE · ${truck} · ${who} · was due ${back}. Reminder sent.`,
      );

    case 'cancelled':
      return wrap(
        `Cancelled — ${who}, ${pickup}`,
        `The ${pickup} booking for ${who} was cancelled${c.detail ? `: ${c.detail}` : ''}. ${truck} is back on the calendar.`,
        `CANCELLED · ${who} · ${pickup}${c.detail ? ` · ${c.detail}` : ''}. Truck released.`,
      );

  }
}
