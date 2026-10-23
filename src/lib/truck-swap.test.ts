import { describe, expect, it } from 'vitest';
import { checkSwap, swapWindowOpen, type SwapCheck } from './truck-swap';

const TODAY = '2026-10-23';

function swap(over: Partial<SwapCheck> = {}): SwapCheck {
  return {
    stage: 'CONFIRMED',
    pickupDate: '2026-10-25',
    today: TODAY,
    currentTruckId: 'truck-a',
    target: { id: 'truck-b', code: 'B', active: true },
    ...over,
  };
}

const reasonOf = (v: ReturnType<typeof checkSwap>) => (v.ok ? '' : v.reason);

describe('checkSwap — accepted bookings whose pickup has not arrived', () => {
  it('allows an accepted booking onto another active truck', () => {
    expect(checkSwap(swap())).toEqual({ ok: true });
  });

  it.each(['2026-10-24', '2026-10-25', '2026-12-31'])('allows a pickup on %s, still ahead', (pickupDate) => {
    expect(checkSwap(swap({ pickupDate })).ok).toBe(true);
  });

  it('refuses once pickup day has arrived — the code may already be out', () => {
    const v = checkSwap(swap({ pickupDate: TODAY }));
    expect(v.ok).toBe(false);
    expect(reasonOf(v).toLowerCase()).toContain('pickup');
  });

  it('refuses a pickup date in the past', () => {
    expect(checkSwap(swap({ pickupDate: '2026-10-20' })).ok).toBe(false);
  });

  it.each([
    'NEW_BOOKING',
    'CONTRACT_SENT',
    'ADDITIONAL_DRIVER',
    'AWAITING_APPROVAL',
    'PICKUP_DAY',
    'IN_USE',
    'RETURNED',
    'COMPLETED',
    'CANCELLED',
  ])('refuses a booking that is %s — only accepted ones can move', (stage) => {
    const v = checkSwap(swap({ stage }));
    expect(v.ok).toBe(false);
    expect(reasonOf(v).toLowerCase()).toContain('accepted');
  });

  it('refuses moving onto the truck it is already on', () => {
    const v = checkSwap(swap({ currentTruckId: 'truck-b' }));
    expect(v.ok).toBe(false);
    expect(reasonOf(v).toLowerCase()).toContain('already');
  });

  it('refuses a truck that is switched off, and names it', () => {
    const v = checkSwap(swap({ target: { id: 'truck-b', code: 'B', active: false } }));
    expect(v.ok).toBe(false);
    expect(reasonOf(v)).toContain('Truck B');
    expect(reasonOf(v).toLowerCase()).toContain('off');
  });

  it('allows a booking with no truck yet onto any active truck', () => {
    expect(checkSwap(swap({ currentTruckId: null })).ok).toBe(true);
  });
});

describe('swapWindowOpen — decides whether to show the option at all', () => {
  it('is open for an accepted booking before pickup', () => {
    expect(swapWindowOpen({ stage: 'CONFIRMED', pickupDate: '2026-10-25', today: TODAY })).toEqual({ ok: true });
  });

  it('is closed on pickup day and for any other stage', () => {
    expect(swapWindowOpen({ stage: 'CONFIRMED', pickupDate: TODAY, today: TODAY }).ok).toBe(false);
    expect(swapWindowOpen({ stage: 'AWAITING_APPROVAL', pickupDate: '2026-10-25', today: TODAY }).ok).toBe(false);
  });
});
