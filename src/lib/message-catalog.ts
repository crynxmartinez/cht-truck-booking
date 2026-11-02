import { render, toPlain, type MessageContext, type TemplateKey } from './messages';
import { renderStaff, type StaffContext, type StaffEvent } from './staff-messages';

/**
 * Every message the system can send, with its real wording filled in from a
 * clearly fake renter, and a plain-English line saying when it goes out.
 *
 * This is what the Messages page shows, so the office can read the wording
 * without having to trigger a real send. It is built from the same render
 * functions the live sender uses, so it cannot drift from what people receive.
 */

export const LOCKBOX_PLACEHOLDER = '[lockbox code]';

export type CatalogEntry = {
  audience: 'renter' | 'office';
  key: string;
  title: string;
  /** When it is sent, in a sentence. */
  when: string;
  subject: string;
  email: string;
  sms: string;
};

const SAMPLE: MessageContext = {
  firstName: 'Sample',
  lastName: 'Renter',
  reference: 'CHT-SAMPLE',
  truckCode: 'A',
  pickupDate: '2026-12-10',
  returnDate: '2026-12-12',
  lockboxCode: LOCKBOX_PLACEHOLDER,
  contractToken: 'sample-link',
  pickupChecklistToken: 'sample-link',
  dropoffChecklistToken: 'sample-link',
  additionalDriverName: 'Sample Driver',
  renterName: 'Sample Renter',
  agreementSigned: true,
};

const SAMPLE_STAFF: StaffContext = {
  reference: 'CHT-SAMPLE',
  renterName: 'Sample Renter',
  renterEmail: 'sample@example.com',
  renterPhone: '555-010-0000',
  truckCode: 'A',
  pickupDate: '2026-12-10',
  returnDate: '2026-12-12',
  additionalDriverName: 'Sample Driver',
  detail: 'Sample note',
  reportedTime: '9:00 AM',
};

// Typed as Records so adding a message anywhere in the system without
// describing it here is a compile error, not a gap nobody notices.
const RENTER: Record<TemplateKey, { title: string; when: string }> = {
  booking_received: { title: 'Booking received', when: 'Right after a booking is made, online or by the office.' },
  contract_to_sign: { title: 'Agreement to sign', when: 'At the same moment: the link to read and sign the rental agreement.' },
  contract_nudge: { title: 'Reminder to sign', when: 'Once, at the daily check, if the agreement is still unsigned more than 24 hours after booking.' },
  additional_driver: { title: 'Second driver to sign', when: 'When the renter names a second driver. It goes to that driver, with their own signing link.' },
  dates_changed: { title: 'Dates changed', when: 'When the office changes the dates of a booking.' },
  truck_changed: { title: 'Truck changed', when: 'When the office moves the booking to the other truck.' },
  rental_confirmed: { title: 'Rental confirmed', when: 'When the main admin approves the signed agreement. Nothing says “confirmed” before this.' },
  pickup_morning: { title: 'Pickup day: lockbox code', when: 'On the pickup day, at the first-text time in Settings. If the booking is approved later that day, it goes out straight away.' },
  pickup_reminder: { title: 'Pickup day: reminder', when: 'On the pickup day, only while the renter has not sent their pickup photos.' },
  pickup_no_show_check: { title: 'Pickup day: final text', when: 'On the pickup day, only while the pickup photos are still missing. The last one of the day.' },
  return_day: { title: 'Return day', when: 'On the day the truck is due back, at the return-text time in Settings.' },
  overdue: { title: 'Truck is overdue', when: 'At the daily check, when the truck is a day or more past its return date.' },
  thank_you: { title: 'Thank you', when: 'When the renter submits their return photos.' },
};

const OFFICE: Record<StaffEvent, { title: string; when: string }> = {
  booking_received: { title: 'New booking', when: 'When a booking is made.' },
  additional_driver_invited: { title: 'Second driver named', when: 'When the renter names a second driver.' },
  awaiting_approval: { title: 'Needs approval', when: 'When the renter has signed and the rental is waiting for your approval. Marked urgent.' },
  confirmed: { title: 'Rental confirmed', when: 'When the agreement is approved.' },
  picked_up: { title: 'Truck picked up', when: 'When the renter sends their pickup photos.' },
  returned: { title: 'Truck returned', when: 'When the renter sends their return photos.' },
  reschedule_requested: { title: 'Renter asked to reschedule', when: 'When a renter replies to a text asking to change their dates. Marked urgent.' },
  overdue: { title: 'Truck overdue', when: 'When a truck is a day or more past its return date. Marked urgent.' },
  dates_changed: { title: 'Dates changed', when: 'When the dates of a booking are changed.' },
  truck_changed: { title: 'Truck changed', when: 'When a booking is moved to the other truck.' },
  cancelled: { title: 'Booking cancelled', when: 'When a booking is cancelled, by the office or automatically.' },
};

/** All messages, renter first, in roughly the order a rental runs. */
export function messageCatalog(): CatalogEntry[] {
  const renter = (Object.keys(RENTER) as TemplateKey[]).map((key): CatalogEntry => {
    const r = render(key, SAMPLE);
    return { audience: 'renter', key, ...RENTER[key], subject: r.subject, email: toPlain(r.email), sms: r.sms };
  });
  const office = (Object.keys(OFFICE) as StaffEvent[]).map((key): CatalogEntry => {
    const r = renderStaff(key, SAMPLE_STAFF);
    return { audience: 'office', key, ...OFFICE[key], subject: r.subject, email: toPlain(r.email), sms: r.sms };
  });
  return [...renter, ...office];
}
