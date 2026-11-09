import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SAME_DAY_RETURN_HOUR, returnTextDue, type ReturnFacts } from './return-text';

const TODAY = '2026-12-03';
const base: ReturnFacts = { pickupDate: '2026-12-01', returnDate: TODAY, stage: 'IN_USE', today: TODAY, hour: 7, returnHour: 7 };

describe('a rental of two or more days: as before', () => {
  it('goes out once, at the return-text hour, on the day the truck is due back', () => {
    expect(returnTextDue(base)).toBe(true);
    expect(returnTextDue({ ...base, hour: 6 })).toBe(false);
    expect(returnTextDue({ ...base, hour: 8 })).toBe(false);
  });

  it('goes out for a truck that is out, and for one whose pickup photos never came', () => {
    expect(returnTextDue({ ...base, stage: 'IN_USE' })).toBe(true);
    expect(returnTextDue({ ...base, stage: 'PICKUP_DAY' })).toBe(true);
  });

  it('does not go out on any other day, or for a booking that is not out', () => {
    expect(returnTextDue({ ...base, returnDate: '2026-12-04' })).toBe(false);
    for (const stage of ['NEW_BOOKING', 'CONTRACT_SENT', 'AWAITING_APPROVAL', 'CONFIRMED', 'RETURNED', 'COMPLETED', 'CANCELLED']) {
      expect(returnTextDue({ ...base, stage }), stage).toBe(false);
    }
  });

  it('follows the return-text hour setting', () => {
    expect(returnTextDue({ ...base, returnHour: 8, hour: 8 })).toBe(true);
    expect(returnTextDue({ ...base, returnHour: 8, hour: 7 })).toBe(false);
  });
});

describe('a one-day rental: the code and “due back today” must not arrive an hour apart', () => {
  const oneDay: ReturnFacts = { ...base, pickupDate: TODAY, returnDate: TODAY };

  it('is not sent at the usual return hour, even if the renter already has the truck', () => {
    expect(returnTextDue({ ...oneDay, hour: 7 })).toBe(false);
  });

  it('waits until midday', () => {
    expect(SAME_DAY_RETURN_HOUR).toBe(12);
    expect(returnTextDue({ ...oneDay, hour: 11 })).toBe(false);
    expect(returnTextDue({ ...oneDay, hour: 12 })).toBe(true);
  });

  it('still goes out in the afternoon, so a late pickup is not missed', () => {
    for (const hour of [13, 15, 17, 19]) expect(returnTextDue({ ...oneDay, hour }), String(hour)).toBe(true);
  });

  it('waits for the renter to actually have the truck: not while still on pickup day or confirmed', () => {
    for (const stage of ['PICKUP_DAY', 'CONFIRMED', 'AWAITING_APPROVAL', 'CONTRACT_SENT']) {
      expect(returnTextDue({ ...oneDay, stage, hour: 14 }), stage).toBe(false);
    }
  });

  it('respects a later return-text setting, never going out earlier than it', () => {
    expect(returnTextDue({ ...oneDay, returnHour: 15, hour: 13 })).toBe(false);
    expect(returnTextDue({ ...oneDay, returnHour: 15, hour: 15 })).toBe(true);
  });
});

describe('a manual run', () => {
  it('ignores the hour for a longer rental, so it can be tested any time', () => {
    expect(returnTextDue({ ...base, hour: 3, force: true })).toBe(true);
  });

  it('still never texts a one-day renter who does not have the truck', () => {
    expect(returnTextDue({ ...base, pickupDate: TODAY, stage: 'PICKUP_DAY', hour: 3, force: true })).toBe(false);
    expect(returnTextDue({ ...base, pickupDate: TODAY, stage: 'IN_USE', hour: 3, force: true })).toBe(true);
  });
});

describe('properties', () => {
  const facts = fc.record({
    pickupDate: fc.constantFrom('2026-12-01', '2026-12-02', TODAY),
    returnDate: fc.constantFrom('2026-12-02', TODAY, '2026-12-04'),
    stage: fc.constantFrom('NEW_BOOKING', 'CONFIRMED', 'PICKUP_DAY', 'IN_USE', 'RETURNED', 'COMPLETED', 'CANCELLED'),
    today: fc.constant(TODAY),
    hour: fc.integer({ min: 0, max: 23 }),
    returnHour: fc.integer({ min: 4, max: 12 }),
  });

  it('a one-day rental is only ever texted once the renter has the truck', () => {
    fc.assert(
      fc.property(facts, (f) => {
        if (f.pickupDate === f.returnDate && returnTextDue(f)) expect(f.stage).toBe('IN_USE');
      }),
      { numRuns: 2000 },
    );
  });

  it('nobody is ever texted that the truck is due back on a day it is not due', () => {
    fc.assert(
      fc.property(facts, (f) => {
        if (f.returnDate !== f.today) expect(returnTextDue(f)).toBe(false);
      }),
      { numRuns: 1000 },
    );
  });

  it('a one-day rental is never texted before midday', () => {
    fc.assert(
      fc.property(facts, (f) => {
        if (f.pickupDate === f.returnDate && f.hour < SAME_DAY_RETURN_HOUR) expect(returnTextDue(f)).toBe(false);
      }),
      { numRuns: 1000 },
    );
  });
});
