import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays } from './dates';
import { OFFICE_MAX_DAYS, checkBooking, customerDefaultDays, earliestFor, requestedDays, type Limits } from './booking-rules';

const TODAY = '2026-11-10';
const limits: Limits = { today: TODAY, minLeadDays: 1, latest: '2027-02-28', customerMaxDays: 3 };

describe('customers — tight rules', () => {
  it('cannot book today', () => {
    const r = checkBooking('customer', TODAY, 1, limits);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/too soon/i);
  });

  it('can book tomorrow', () => {
    expect(checkBooking('customer', '2026-11-11', 1, limits)).toEqual({ ok: true, notes: [] });
  });

  it('cannot book yesterday or any earlier day', () => {
    expect(checkBooking('customer', '2026-11-09', 1, limits).ok).toBe(false);
    expect(checkBooking('customer', '2025-01-01', 1, limits).ok).toBe(false);
  });

  it('follows the notice setting: two days of notice closes tomorrow too', () => {
    const l = { ...limits, minLeadDays: 2 };
    expect(checkBooking('customer', '2026-11-11', 1, l).ok).toBe(false);
    expect(checkBooking('customer', '2026-11-12', 1, l).ok).toBe(true);
  });

  it('cannot book past the furthest date offered, but can on that date', () => {
    expect(checkBooking('customer', '2027-02-28', 1, limits).ok).toBe(true);
    const r = checkBooking('customer', '2027-03-01', 1, limits);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/further out/i);
  });

  it('can pick 1 up to the most days allowed, and no more', () => {
    for (const d of [1, 2, 3]) expect(checkBooking('customer', '2026-11-11', d, limits).ok, String(d)).toBe(true);
    const r = checkBooking('customer', '2026-11-11', 4, limits);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/1 to 3 days/i);
  });

  it('says the right range when the maximum is changed in Settings', () => {
    const r = checkBooking('customer', '2026-11-11', 3, { ...limits, customerMaxDays: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/1 to 2 days/i);
    expect(checkBooking('customer', '2026-11-11', 1, { ...limits, customerMaxDays: 1 }).ok).toBe(true);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects a length of %s', (days) => {
    expect(checkBooking('customer', '2026-11-11', days, limits).ok).toBe(false);
    expect(checkBooking('office', '2026-11-11', days, limits).ok).toBe(false);
  });

  it('rejects a date that is not a real date', () => {
    expect(checkBooking('customer', 'tomorrow', 1, limits).ok).toBe(false);
    expect(checkBooking('customer', '2026-13-45', 1, limits).ok).toBe(false);
    expect(checkBooking('office', '', 1, limits).ok).toBe(false);
  });
});

describe('the office — flexible rules', () => {
  it('can book today, and is told it is a same-day booking', () => {
    const r = checkBooking('office', TODAY, 1, limits);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.notes.join(' ')).toMatch(/same-day/i);
  });

  it('can book inside the customers’ notice time, and is told so without being stopped', () => {
    const r = checkBooking('office', '2026-11-11', 2, { ...limits, minLeadDays: 3 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.notes.join(' ')).toMatch(/notice/i);
  });

  it('has nothing to say about an ordinary booking', () => {
    expect(checkBooking('office', '2026-11-20', 2, limits)).toEqual({ ok: true, notes: [] });
  });

  it('cannot book a day that has already gone: a past rental would fire real messages', () => {
    const r = checkBooking('office', '2026-11-09', 1, limits);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/passed/i);
  });

  it('can book any length from 1 to 30 days, and no more', () => {
    expect(OFFICE_MAX_DAYS).toBe(30);
    expect(checkBooking('office', '2026-11-20', 30, limits).ok).toBe(true);
    const r = checkBooking('office', '2026-11-20', 31, limits);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/1 to 30/);
  });

  it('can book beyond the date customers can reach, but not absurdly far', () => {
    expect(checkBooking('office', '2027-06-01', 2, limits).ok).toBe(true);
    expect(checkBooking('office', addDays(TODAY, 800), 2, limits).ok).toBe(false);
  });
});

describe('earliestFor and customerDefaultDays', () => {
  it('earliest pickup for customers is today plus the notice', () => {
    expect(earliestFor(limits)).toBe('2026-11-11');
    expect(earliestFor({ ...limits, minLeadDays: 0 })).toBe(TODAY);
    expect(earliestFor({ ...limits, minLeadDays: 3 })).toBe('2026-11-13');
  });

  it('the length a customer gets without choosing is the house default, never above the maximum', () => {
    expect(customerDefaultDays(3, 3)).toBe(3);
    expect(customerDefaultDays(2, 3)).toBe(2);
    expect(customerDefaultDays(7, 3)).toBe(3);
    expect(customerDefaultDays(1, 3)).toBe(1);
  });
});

describe('properties', () => {
  const pickup = fc.integer({ min: -3, max: 140 }).map((n) => addDays(TODAY, n));
  const days = fc.integer({ min: -1, max: 40 });
  const lim = fc.record({
    today: fc.constant(TODAY),
    minLeadDays: fc.integer({ min: 0, max: 5 }),
    latest: fc.integer({ min: 30, max: 120 }).map((n) => addDays(TODAY, n)),
    customerMaxDays: fc.integer({ min: 1, max: 7 }),
  });

  it('anything a customer is allowed to book, the office is allowed to book too', () => {
    fc.assert(
      fc.property(pickup, days, lim, (p, d, l) => {
        if (checkBooking('customer', p, d, l).ok) expect(checkBooking('office', p, d, l).ok).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });

  it('no customer booking is ever allowed on or before today, whatever the settings', () => {
    fc.assert(
      fc.property(pickup, days, lim, (p, d, l) => {
        if (p <= TODAY && l.minLeadDays >= 1) expect(checkBooking('customer', p, d, l).ok).toBe(false);
      }),
      { numRuns: 1000 },
    );
  });
});

describe('requestedDays — reading the length from a request', () => {
  it('uses the house length when none was sent, as pages loaded before this change do', () => {
    expect(requestedDays(undefined, 3)).toBe(3);
  });

  it('reads a number or a numeric string', () => {
    expect(requestedDays(2, 3)).toBe(2);
    expect(requestedDays('2', 3)).toBe(2);
  });

  it('turns anything unreadable into something the rules will refuse, never into a default', () => {
    // A garbled length must not quietly become a 3-day booking.
    for (const bad of [null, '', 'two', '1.5', {}, [], true, Number.NaN]) {
      const n = requestedDays(bad, 3);
      expect(checkBooking('customer', '2026-11-11', n, limits).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});
