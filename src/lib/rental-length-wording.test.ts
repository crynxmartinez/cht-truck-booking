import { describe, expect, it } from 'vitest';
import { rentalDaysBetween } from './dates';
import { render, renderDefault, type MessageContext } from './messages';
import { renderStaff } from './staff-messages';
import { EDITABLE, defaultWording, previewWording } from './wording';
import { PLACEHOLDERS } from './wording-fill';
import { wordingValues } from './wording-values';

const ctx = (days?: number): MessageContext => ({
  firstName: 'Marisol',
  reference: 'CHT-8KQ2',
  truckCode: 'B',
  pickupDate: '2026-12-03',
  returnDate: '2026-12-03',
  contractToken: 'tok-sign-1',
  pickupChecklistToken: 'tok-pick-1',
  dropoffChecklistToken: 'tok-drop-1',
  lockboxCode: '48151',
  additionalDriverName: 'Tomas Vega',
  renterName: 'Marisol Vega',
  rentalDays: days,
});

describe('rentalDaysBetween', () => {
  it('counts the pickup day: one day when pickup and return are the same day', () => {
    expect(rentalDaysBetween('2026-12-03', '2026-12-03')).toBe(1);
    expect(rentalDaysBetween('2026-12-03', '2026-12-04')).toBe(2);
    expect(rentalDaysBetween('2026-12-03', '2026-12-05')).toBe(3);
  });

  it('works across a month end', () => {
    expect(rentalDaysBetween('2026-11-30', '2026-12-02')).toBe(3);
  });
});

describe('the renter emails say the real length', () => {
  it.each([1, 2, 3])('booking_received, %s days', (n) => {
    const r = render('booking_received', ctx(n));
    expect(r.email).toContain(`Your ${n}-day truck rental request is in.`);
    if (n !== 3) expect(r.email).not.toContain('3-day');
  });

  it.each([1, 2, 3])('rental_confirmed, %s days', (n) => {
    const r = render('rental_confirmed', ctx(n));
    expect(r.sms).toContain(`Your ${n} Day Truck Rental Booking is already approved.`);
  });

  it('still says 3 days when the length is not known, as before', () => {
    expect(render('booking_received', ctx(undefined)).email).toContain('Your 3-day truck rental request is in.');
    expect(render('rental_confirmed', ctx(undefined)).sms).toContain('Your 3 Day Truck Rental Booking is already approved.');
  });
});

describe('the message editor copes with the length', () => {
  it('knows a placeholder for it', () => {
    expect(PLACEHOLDERS.map((p) => p.name)).toContain('rentalDays');
    expect(wordingValues(ctx(2)).rentalDays).toBe('2');
    expect(wordingValues(ctx(undefined)).rentalDays).toBe('3');
  });

  it('shows the length as a placeholder in the editable text, not as a fixed 3', () => {
    expect(defaultWording('booking_received').email).toContain('Your {rentalDays}-day truck rental request is in.');
    expect(defaultWording('rental_confirmed').sms).toContain('Your {rentalDays} Day Truck Rental Booking');
  });

  it.each([1, 2, 3])('puts today’s text back exactly, for a %s-day rental', (n) => {
    for (const key of EDITABLE) {
      const expected = renderDefault(key, ctx(n));
      const filled = previewWording(key, defaultWording(key), ctx(n));
      expect(filled, `${key} ${n}`).toEqual({ ok: true, rendered: { subject: expected.subject, email: expected.email, sms: expected.sms } });
    }
  });

  it('does not turn other threes, such as a time or a date, into the length', () => {
    for (const key of EDITABLE) {
      const d = defaultWording(key);
      expect(`${d.subject}${d.email}${d.sms}`, key).not.toMatch(/\{rentalDays\}\d|\d\{rentalDays\}/);
    }
  });
});

describe('the office alert shows the length', () => {
  const base = {
    reference: 'CHT-X',
    renterName: 'Ana Test',
    renterEmail: 'a@b.co',
    renterPhone: '555-010-0000',
    truckCode: 'A',
    pickupDate: '2026-12-03',
  };

  it.each([
    ['2026-12-03', '1 day'],
    ['2026-12-04', '2 days'],
    ['2026-12-05', '3 days'],
  ])('a rental back on %s is %s', (returnDate, label) => {
    expect(renderStaff('booking_received', { ...base, returnDate }).email).toContain(`Length:   ${label}`);
  });
});
