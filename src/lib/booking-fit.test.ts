import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays, overlaps } from './dates';
import { chooseTruck, freeRun, maxDaysOn, withBuffer, type Interval, type TruckHolds } from './booking-fit';

const day = (iso: string, n = 0) => addDays(iso, n);
const hold = (start: string, end: string): Interval => ({ start, end });
const truck = (code: string, ...holds: Interval[]): TruckHolds => ({ id: `t-${code}`, code, holds });

describe('freeRun — days in a row a truck is free from a date', () => {
  it('is the whole cap when nothing is booked', () => {
    expect(freeRun([], '2026-11-01', 3)).toBe(3);
  });

  it('stops at the day before the next booking', () => {
    // Nov 3 is booked: Nov 1 and Nov 2 are free.
    expect(freeRun([hold('2026-11-03', '2026-11-05')], '2026-11-01', 3)).toBe(2);
  });

  it('is zero when the day itself is taken', () => {
    expect(freeRun([hold('2026-10-30', '2026-11-01')], '2026-11-01', 3)).toBe(0);
    expect(freeRun([hold('2026-11-01', '2026-11-01')], '2026-11-01', 3)).toBe(0);
  });

  it('is one when only the next day is taken', () => {
    expect(freeRun([hold('2026-11-02', '2026-11-04')], '2026-11-01', 3)).toBe(1);
  });

  it('ignores a booking that ended the day before: the truck is free again the next day', () => {
    expect(freeRun([hold('2026-10-29', '2026-10-31')], '2026-11-01', 3)).toBe(3);
  });

  it('never reports more than the cap', () => {
    expect(freeRun([], '2026-11-01', 2)).toBe(2);
    expect(freeRun([hold('2026-11-20', '2026-11-22')], '2026-11-01', 60)).toBe(19);
  });

  it('finds the nearest of several bookings', () => {
    const holds = [hold('2026-11-09', '2026-11-10'), hold('2026-11-04', '2026-11-05'), hold('2026-11-20', '2026-11-21')];
    expect(freeRun(holds, '2026-11-01', 30)).toBe(3);
  });
});

describe('withBuffer — empty days a customer must leave around other rentals', () => {
  it('widens every booking on both sides', () => {
    expect(withBuffer([hold('2026-11-05', '2026-11-07')], 1)).toEqual([hold('2026-11-04', '2026-11-08')]);
    expect(withBuffer([hold('2026-11-05', '2026-11-07')], 2)).toEqual([hold('2026-11-03', '2026-11-09')]);
  });

  it('changes nothing for a buffer of zero', () => {
    const holds = [hold('2026-11-05', '2026-11-07')];
    expect(withBuffer(holds, 0)).toEqual(holds);
  });

  it('does not alter the list it was given', () => {
    const holds = [hold('2026-11-05', '2026-11-07')];
    withBuffer(holds, 3);
    expect(holds).toEqual([hold('2026-11-05', '2026-11-07')]);
  });
});

describe('maxDaysOn — what a customer could book starting on a date (your Nov 1 / Nov 3 example)', () => {
  const nov3 = hold('2026-11-03', '2026-11-05');

  it('gives 3 days when one truck has Nov 3 booked and the other is free', () => {
    expect(maxDaysOn([truck('A', nov3), truck('B')], '2026-11-01', 3, 0)).toBe(3);
  });

  it('gives 2 days when both trucks have Nov 3 booked', () => {
    expect(maxDaysOn([truck('A', nov3), truck('B', nov3)], '2026-11-01', 3, 0)).toBe(2);
  });

  it('gives 1 day when both trucks are booked from Nov 2', () => {
    const nov2 = hold('2026-11-02', '2026-11-04');
    expect(maxDaysOn([truck('A', nov2), truck('B', nov2)], '2026-11-01', 3, 0)).toBe(1);
  });

  it('offers nothing when both trucks are busy on the day itself', () => {
    const busy = hold('2026-11-01', '2026-11-02');
    expect(maxDaysOn([truck('A', busy), truck('B', busy)], '2026-11-01', 3, 0)).toBe(0);
  });

  it('takes the better of two different trucks', () => {
    expect(maxDaysOn([truck('A', hold('2026-11-02', '2026-11-03')), truck('B', nov3)], '2026-11-01', 3, 0)).toBe(2);
  });

  it('offers nothing when there are no trucks', () => {
    expect(maxDaysOn([], '2026-11-01', 3, 0)).toBe(0);
  });

  it('with an empty-day buffer of 1, both trucks booked from Nov 3 leaves only 1 day', () => {
    expect(maxDaysOn([truck('A', nov3), truck('B', nov3)], '2026-11-01', 3, 1)).toBe(1);
  });

  it('with a buffer, the day after a rental ends is not offered', () => {
    const ends = hold('2026-10-29', '2026-10-31');
    expect(maxDaysOn([truck('A', ends)], '2026-11-01', 3, 1)).toBe(0);
    expect(maxDaysOn([truck('A', ends)], '2026-11-02', 3, 1)).toBe(3);
  });
});

describe('chooseTruck — the tightest fit keeps the longer slot open', () => {
  it('prefers the truck that is free for the least time beyond the request', () => {
    // A is free for 2 more days only; B is free for a long stretch. A 2-day request takes A.
    const A = truck('A', hold('2026-11-03', '2026-11-05'));
    const B = truck('B');
    expect(chooseTruck([A, B], '2026-11-01', 2, 0, null)?.code).toBe('A');
  });

  it('gives the open-ended truck to a 3-day request when only it fits', () => {
    const A = truck('A', hold('2026-11-03', '2026-11-05'));
    const B = truck('B');
    expect(chooseTruck([A, B], '2026-11-01', 3, 0, null)?.code).toBe('B');
  });

  it('takes the first truck in order when they fit equally', () => {
    expect(chooseTruck([truck('A'), truck('B')], '2026-11-01', 2, 0, null)?.code).toBe('A');
  });

  it('honours a requested truck if it is free, even when it is not the tightest', () => {
    const A = truck('A', hold('2026-11-03', '2026-11-05'));
    const B = truck('B');
    expect(chooseTruck([A, B], '2026-11-01', 2, 0, 't-B')?.code).toBe('B');
  });

  it('ignores a requested truck that is not free', () => {
    const A = truck('A', hold('2026-11-02', '2026-11-05'));
    const B = truck('B');
    expect(chooseTruck([A, B], '2026-11-01', 2, 0, 't-A')?.code).toBe('B');
  });

  it('returns nothing when no truck fits', () => {
    const busy = hold('2026-11-02', '2026-11-05');
    expect(chooseTruck([truck('A', busy), truck('B', busy)], '2026-11-01', 2, 0, null)).toBeNull();
  });

  it('respects the buffer when choosing', () => {
    const A = truck('A', hold('2026-11-03', '2026-11-05'));
    expect(chooseTruck([A], '2026-11-01', 2, 1, null)).toBeNull();
    expect(chooseTruck([A], '2026-11-01', 1, 1, null)?.code).toBe('A');
  });
});

describe('properties — the engine agrees with a plain brute-force check', () => {
  const BASE = '2026-11-01';
  const interval = fc
    .tuple(fc.integer({ min: -4, max: 14 }), fc.integer({ min: 0, max: 4 }))
    .map(([s, len]) => hold(day(BASE, s), day(BASE, s + len)));
  const truckArb = fc.array(interval, { maxLength: 4 });
  const trucksArb = fc.array(truckArb, { minLength: 1, maxLength: 3 }).map((all) => all.map((h, i) => truck(String.fromCharCode(65 + i), ...h)));
  const start = fc.integer({ min: 0, max: 10 }).map((n) => day(BASE, n));

  /** A rental of `k` days from `d` fits a truck if nothing, widened by the buffer, overlaps it. */
  const fits = (t: TruckHolds, d: string, k: number, buffer: number) =>
    !t.holds.some((h) => overlaps(d, day(d, k - 1), day(h.start, -buffer), day(h.end, buffer)));

  it('maxDaysOn is the longest length, up to the cap, that fits some truck', () => {
    fc.assert(
      fc.property(trucksArb, start, fc.integer({ min: 1, max: 7 }), fc.integer({ min: 0, max: 2 }), (trucks, d, cap, buffer) => {
        let expected = 0;
        for (let k = cap; k >= 1; k -= 1) {
          if (trucks.some((t) => fits(t, d, k, buffer))) {
            expected = k;
            break;
          }
        }
        expect(maxDaysOn(trucks, d, cap, buffer)).toBe(expected);
      }),
      { numRuns: 1500 },
    );
  });

  it('chooseTruck only ever returns a truck that is free, and returns one whenever any truck is', () => {
    fc.assert(
      fc.property(trucksArb, start, fc.integer({ min: 1, max: 5 }), fc.integer({ min: 0, max: 2 }), (trucks, d, days, buffer) => {
        const picked = chooseTruck(trucks, d, days, buffer, null);
        const anyFree = trucks.some((t) => fits(t, d, days, buffer));
        expect(picked !== null).toBe(anyFree);
        if (picked) expect(fits(trucks.find((t) => t.id === picked.id)!, d, days, buffer)).toBe(true);
      }),
      { numRuns: 1500 },
    );
  });

  it('a longer length never fits where a shorter one does not', () => {
    fc.assert(
      fc.property(trucksArb, start, (trucks, d) => {
        const lengths = [1, 2, 3, 4, 5].map((k) => trucks.some((t) => fits(t, d, k, 0)));
        for (let i = 1; i < lengths.length; i += 1) if (lengths[i]) expect(lengths[i - 1]).toBe(true);
      }),
      { numRuns: 800 },
    );
  });
});
