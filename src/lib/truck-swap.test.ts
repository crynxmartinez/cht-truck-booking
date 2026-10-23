import { describe, expect, it } from 'vitest';
import { checkSwap, swapWindowOpen, type SwapCheck } from './truck-swap';

const TODAY = '2026-10-23';

function swap(over: Partial<SwapCheck> = {}): SwapCheck {
  return {
    stage: 'CONFIRMED',
    pickupDate: '2026-10-25',
    today: TODAY,
    codeSent: false,
    currentTruckId: 'truck-a',
    target: { id: 'truck-b', code: 'B', active: true },
    ...over,
  };
}

const reasonOf = (v: ReturnType<typeof checkSwap>) => (v.ok ? '' : v.reason);

describe('checkSwap — any booking before its booking period', () => {
  it.each(['NEW_BOOKING', 'CONTRACT_SENT', 'ADDITIONAL_DRIVER', 'AWAITING_APPROVAL', 'CONFIRMED'])(
    'allows a %s booking whose pickup is still ahead',
    (stage) => {
      expect(checkSwap(swap({ stage })).ok).toBe(true);
    },
  );

  it.each(['2026-10-24', '2026-10-31', '2026-12-31'])('allows a pickup on %s', (pickupDate) => {
    expect(checkSwap(swap({ pickupDate })).ok).toBe(true);
  });

  it('refuses a pickup date that has already passed', () => {
    const v = checkSwap(swap({ pickupDate: '2026-10-20' }));
    expect(v.ok).toBe(false);
    expect(reasonOf(v).toLowerCase()).toContain('passed');
  });

  it.each(['PICKUP_DAY', 'IN_USE', 'RETURNED', 'COMPLETED', 'CANCELLED'])(
    'refuses a %s booking — the rental has started or finished',
    (stage) => {
      const v = checkSwap(swap({ stage }));
      expect(v.ok).toBe(false);
      expect(reasonOf(v).toLowerCase()).toContain('started or finished');
    },
  );
});

describe('checkSwap — the day itself', () => {
  it('allows a pickup that is today while the lockbox code has not gone out', () => {
    expect(checkSwap(swap({ pickupDate: TODAY, codeSent: false })).ok).toBe(true);
  });

  it('refuses a pickup that is today once the code is out — the renter holds the wrong truck’s code', () => {
    const v = checkSwap(swap({ pickupDate: TODAY, codeSent: true }));
    expect(v.ok).toBe(false);
    expect(reasonOf(v).toLowerCase()).toContain('code');
  });

  it('does not care about the code for a future pickup', () => {
    expect(checkSwap(swap({ pickupDate: '2026-10-25', codeSent: true })).ok).toBe(true);
  });
});

describe('checkSwap — the target truck', () => {
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
  const win = { stage: 'AWAITING_APPROVAL', pickupDate: '2026-10-31', today: TODAY, codeSent: false };

  it('is open before the booking period', () => {
    expect(swapWindowOpen(win)).toEqual({ ok: true });
  });

  it('is open today until the code goes out, then closed', () => {
    expect(swapWindowOpen({ ...win, pickupDate: TODAY }).ok).toBe(true);
    expect(swapWindowOpen({ ...win, pickupDate: TODAY, codeSent: true }).ok).toBe(false);
  });

  it('is closed once the rental has started', () => {
    expect(swapWindowOpen({ ...win, stage: 'IN_USE' }).ok).toBe(false);
  });
});
