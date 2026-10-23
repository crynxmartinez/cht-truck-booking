import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { findOverlaps, type HoldRow } from './invariants';
import { DEFAULT_SCHEDULE, nextPickupMessage, type PickupTemplate } from './pickup-schedule';
import { checkSwap } from './truck-swap';

/**
 * Property tests: instead of hand-picked examples, state what must ALWAYS be
 * true and let the library hunt for a counter-example. The expected values are
 * restated independently here, not imported from the code under test.
 */

const ALL_STAGES = [
  'NEW_BOOKING', 'CONTRACT_SENT', 'ADDITIONAL_DRIVER', 'AWAITING_APPROVAL', 'CONFIRMED',
  'PICKUP_DAY', 'IN_USE', 'RETURNED', 'COMPLETED', 'CANCELLED',
] as const;
const BEFORE_PICKUP = ['NEW_BOOKING', 'CONTRACT_SENT', 'ADDITIONAL_DRIVER', 'AWAITING_APPROVAL', 'CONFIRMED'];

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

describe('swap rule — property', () => {
  it('allows a swap exactly when the independent statement of the rule says so', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_STAGES),
        fc.integer({ min: -6, max: 12 }),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        (stage, offset, codeSent, active, sameTruck) => {
          const today = '2026-10-23';
          const pickupDate = addDays(today, offset);
          const verdict = checkSwap({
            stage,
            pickupDate,
            today,
            codeSent,
            currentTruckId: 'truck-a',
            target: { id: sameTruck ? 'truck-a' : 'truck-b', code: sameTruck ? 'A' : 'B', active },
          });

          const expected =
            BEFORE_PICKUP.includes(stage) &&
            offset >= 0 &&
            !(offset === 0 && codeSent) &&
            active &&
            !sameTruck;

          expect(verdict.ok).toBe(expected);
          if (!verdict.ok) expect(verdict.reason.length).toBeGreaterThan(10);
        },
      ),
      { numRuns: 2000 },
    );
  });

  it('never allows a swap once the rental has started, whatever else is true', () => {
    fc.assert(
      fc.property(fc.constantFrom('PICKUP_DAY', 'IN_USE', 'RETURNED', 'COMPLETED', 'CANCELLED'), fc.integer({ min: -3, max: 30 }), (stage, offset) => {
        const v = checkSwap({
          stage,
          pickupDate: addDays('2026-10-23', offset),
          today: '2026-10-23',
          codeSent: false,
          currentTruckId: 'truck-a',
          target: { id: 'truck-b', code: 'B', active: true },
        });
        expect(v.ok).toBe(false);
      }),
    );
  });
});

describe('pickup-day schedule — simulated across a whole day', () => {
  /**
   * Run the hourly cron for every hour of the pickup day. The booking is
   * approved at `approvedAt`, and the renter finishes the pickup checklist at
   * `collectedAt` (or never). Whatever those are, the same promises must hold.
   */
  function simulate(approvedAt: number, collectedAt: number | null) {
    const sent: Partial<Record<PickupTemplate, Date>> = {};
    const log: Array<{ template: PickupTemplate; hour: number; at: Date }> = [];
    let stage = 'AWAITING_APPROVAL';

    for (let hour = 0; hour < 24; hour++) {
      if (hour === approvedAt) stage = 'CONFIRMED';
      const at = new Date(`2026-10-09T${String(hour).padStart(2, '0')}:00:00Z`);
      const next = nextPickupMessage(
        {
          stage,
          pickupDate: '2026-10-09',
          pickupSubmitted: collectedAt !== null && hour >= collectedAt,
          sent: { ...sent },
        },
        { today: '2026-10-09', hour, now: at },
        DEFAULT_SCHEDULE,
      );
      if (next) {
        sent[next] = at;
        log.push({ template: next, hour, at });
        if (next === 'pickup_morning') stage = 'PICKUP_DAY';
      }
    }
    return log;
  }

  const scenario = fc.tuple(fc.integer({ min: 0, max: 23 }), fc.option(fc.integer({ min: 0, max: 23 }), { nil: null }));

  it('never sends more than three messages, and never the same one twice', () => {
    fc.assert(
      fc.property(scenario, ([approvedAt, collectedAt]) => {
        const log = simulate(approvedAt, collectedAt);
        expect(log.length).toBeLessThanOrEqual(3);
        expect(new Set(log.map((l) => l.template)).size).toBe(log.length);
      }),
      { numRuns: 1000 },
    );
  });

  it('sends the code exactly once, at the first tick after approval and no earlier than 6 AM', () => {
    fc.assert(
      fc.property(scenario, ([approvedAt]) => {
        const log = simulate(approvedAt, null);
        const codes = log.filter((l) => l.template === 'pickup_morning');
        expect(codes).toHaveLength(1);
        expect(codes[0].hour).toBe(Math.max(6, approvedAt));
      }),
      { numRuns: 500 },
    );
  });

  it('the code always comes first', () => {
    fc.assert(
      fc.property(scenario, ([approvedAt, collectedAt]) => {
        const log = simulate(approvedAt, collectedAt);
        if (log.length > 0) expect(log[0].template).toBe('pickup_morning');
      }),
      { numRuns: 500 },
    );
  });

  it('never chases anyone who has already collected the truck', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 23 }), (approvedAt, collectedAt) => {
        const log = simulate(approvedAt, collectedAt);
        for (const l of log.filter((m) => m.template !== 'pickup_morning')) {
          expect(l.hour).toBeLessThan(collectedAt);
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('keeps messages at least about three hours apart and stops chasing after 7 PM', () => {
    fc.assert(
      fc.property(scenario, ([approvedAt, collectedAt]) => {
        const log = simulate(approvedAt, collectedAt);
        for (let i = 1; i < log.length; i++) {
          expect(log[i].at.getTime() - log[i - 1].at.getTime()).toBeGreaterThanOrEqual(2 * 3_600_000 + 50 * 60_000);
          expect(log[i].hour).toBeLessThanOrEqual(DEFAULT_SCHEDULE.lastHour);
        }
      }),
      { numRuns: 1000 },
    );
  });
});

describe('findOverlaps — property', () => {
  const holding = ['NEW_BOOKING', 'CONFIRMED', 'IN_USE', 'RETURNED'];

  const booking = fc.record({
    truck: fc.constantFrom('A', 'B', null),
    start: fc.integer({ min: 0, max: 20 }),
    len: fc.integer({ min: 1, max: 5 }),
    stage: fc.constantFrom('CONFIRMED', 'NEW_BOOKING', 'IN_USE', 'CANCELLED', 'COMPLETED'),
  });

  it('agrees with a plain brute-force check, for any set of bookings', () => {
    fc.assert(
      fc.property(fc.array(booking, { maxLength: 12 }), (items) => {
        const rows: HoldRow[] = items.map((b, i) => ({
          id: String(i),
          reference: `CHT-${i}`,
          truckId: b.truck,
          blockStart: addDays('2026-10-01', b.start),
          blockEnd: addDays('2026-10-01', b.start + b.len - 1),
          stage: b.stage,
        }));

        let expected = 0;
        for (let i = 0; i < items.length; i++) {
          for (let j = i + 1; j < items.length; j++) {
            const a = items[i];
            const b = items[j];
            const bothHold = holding.includes(a.stage) && holding.includes(b.stage);
            const sameTruck = a.truck !== null && a.truck === b.truck;
            const share = a.start <= b.start + b.len - 1 && b.start <= a.start + a.len - 1;
            if (bothHold && sameTruck && share) expected++;
          }
        }
        expect(findOverlaps(rows)).toHaveLength(expected);
      }),
      { numRuns: 1000 },
    );
  });
});
