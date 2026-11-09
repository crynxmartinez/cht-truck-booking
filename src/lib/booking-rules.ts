import { addDays, isIsoDate, type IsoDate } from './dates';

/**
 * Who may book what, and when.
 *
 * Customers have tight rules: not today, a few days at most. The office has
 * flexible ones: same day, any length up to a month. One function answers for
 * both, so the booking page and the office screen cannot drift apart, and a
 * test can prove the office is never stricter than a customer.
 *
 * Neither mode can double-book a truck. That is the database's job.
 */

export type Mode = 'customer' | 'office';

export type Limits = {
  today: IsoDate;
  /** Days of notice customers must give. 1 means the earliest pickup is tomorrow. */
  minLeadDays: number;
  /** The last date customers can reach. */
  latest: IsoDate;
  /** The most days a customer can pick. */
  customerMaxDays: number;
};

export const OFFICE_MAX_DAYS = 30;
/** How far ahead the office may book. Past this it is almost certainly a typo in the year. */
export const OFFICE_HORIZON_DAYS = 730;

export type Verdict = { ok: true; notes: string[] } | { ok: false; error: string };

export const earliestFor = (l: Pick<Limits, 'today' | 'minLeadDays'>): IsoDate => addDays(l.today, l.minLeadDays);

/** What a customer gets if they do not choose: the house length, but never more than the maximum. */
export const customerDefaultDays = (customerMax: number, houseDefault: number): number => Math.min(customerMax, houseDefault);

/**
 * The length a request asked for. Absent means the house default, which is what
 * booking pages loaded before customers could choose will send. Anything else
 * unreadable becomes NaN, which the rules refuse: a garbled length must never
 * quietly turn into a booking of a different length.
 */
export function requestedDays(raw: unknown, fallback: number): number {
  if (raw === undefined) return fallback;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) return Number(raw.trim());
  return Number.NaN;
}

export function checkBooking(mode: Mode, pickup: string, days: number, l: Limits): Verdict {
  if (!isIsoDate(pickup)) return { ok: false, error: 'Pick a valid pickup date.' };

  const max = mode === 'customer' ? l.customerMaxDays : OFFICE_MAX_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > max) {
    const range = max === 1 ? '1 day' : `1 to ${max} days`;
    return { ok: false, error: mode === 'office' ? `Length must be ${range}.` : `Choose ${range}.` };
  }

  if (mode === 'customer') {
    if (pickup < earliestFor(l)) return { ok: false, error: 'That date is too soon — please choose a later one.' };
    if (pickup > l.latest) return { ok: false, error: 'That date is further out than we take bookings.' };
    return { ok: true, notes: [] };
  }

  // The office.
  if (pickup < l.today) return { ok: false, error: 'That date has already passed.' };
  if (pickup > addDays(l.today, OFFICE_HORIZON_DAYS)) return { ok: false, error: 'That date is too far ahead. Check the year.' };

  const notes: string[] = [];
  if (pickup === l.today) {
    notes.push('This is a same-day booking.');
  } else if (pickup < earliestFor(l)) {
    notes.push('This is inside the normal notice time for customers. That is fine for the office.');
  }
  return { ok: true, notes };
}
