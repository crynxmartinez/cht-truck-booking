import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted above everything else in the file, so anything
// they refer to has to be created with vi.hoisted or it does not exist yet.
const h = vi.hoisted(() => ({
  reassignTruck: vi.fn(),
  notify: vi.fn(),
  notifyStaff: vi.fn(),
  logEvent: vi.fn(),
  syncBookingToCalendar: vi.fn(),
  setStage: vi.fn(),
  reopenBooking: vi.fn(),
  cancelBooking: vi.fn(),
  moveBooking: vi.fn(),
  findBooking: vi.fn(),
  StaleMoveError: class StaleMoveError extends Error {},
  pending: [] as Array<Promise<unknown>>,
  NoTruckAvailableError: class NoTruckAvailableError extends Error {},
  SwapNotAllowedError: class SwapNotAllowedError extends Error {},
}));

vi.mock('@/lib/availability', () => ({
  reassignTruck: h.reassignTruck,
  NoTruckAvailableError: h.NoTruckAvailableError,
  SwapNotAllowedError: h.SwapNotAllowedError,
}));
vi.mock('@/lib/notify', () => ({
  notify: h.notify,
  notifyStaff: h.notifyStaff,
  logEvent: h.logEvent,
  setStage: h.setStage,
}));
vi.mock('@/lib/calendar-sync', () => ({ syncBookingToCalendar: h.syncBookingToCalendar }));
vi.mock('@/lib/db', () => ({ prisma: { booking: { findUnique: h.findBooking } } }));
vi.mock('@/lib/bookings', () => ({
  cancelBooking: h.cancelBooking,
  completeBooking: vi.fn(),
  reopenBooking: h.reopenBooking,
  moveBooking: h.moveBooking,
  StaleMoveError: h.StaleMoveError,
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// Run the post-response work for real, and keep hold of it so a test can wait.
vi.mock('next/server', () => ({ after: (fn: () => Promise<unknown>) => h.pending.push(fn()) }));

import { cancel, moveCard, reopen, switchTruck } from './actions';

const moved = { id: 'b1', truck: { code: 'B' }, previousTruckCode: 'A' };

beforeEach(() => {
  vi.clearAllMocks();
  h.pending.length = 0;
  h.reassignTruck.mockResolvedValue(moved);
  h.notify.mockResolvedValue({ sent: ['EMAIL', 'SMS'], skipped: [], errors: [] });
  h.notifyStaff.mockResolvedValue(undefined);
});

describe('switchTruck', () => {
  it('moves the booking, records it, updates the calendar, and says it is telling people', async () => {
    const res = await switchTruck('b1', 'truck-b');
    await Promise.all(h.pending);

    expect(res).toEqual({ ok: true, message: expect.stringContaining('Truck B') });
    expect(res.ok && res.message).toContain('being told');
    expect(h.syncBookingToCalendar).toHaveBeenCalledWith('b1');
    expect(h.logEvent).toHaveBeenCalledWith(
      'b1',
      'truck_reassigned',
      expect.stringMatching(/Truck A to Truck B.*signed agreement/),
      'ops',
    );
  });

  it('forces both messages, because the same booking can change truck twice', async () => {
    await switchTruck('b1', 'truck-b');
    await Promise.all(h.pending);

    expect(h.notify).toHaveBeenCalledWith('b1', 'truck_changed', { force: true });
    expect(h.notifyStaff).toHaveBeenCalledWith(
      'b1',
      'truck_changed',
      { detail: 'Truck A to Truck B' },
      { force: true },
    );
  });

  it('records a failed send, since notify() reports failure rather than throwing', async () => {
    h.notify.mockResolvedValue({ sent: [], skipped: [], errors: ['EMAIL: timeout', 'SMS: timeout'] });
    await switchTruck('b1', 'truck-b');
    await Promise.all(h.pending);

    expect(h.logEvent).toHaveBeenCalledWith('b1', 'notify_failed', expect.stringContaining('timeout'), 'system');
  });

  it('passes the refusal straight back and tells nobody', async () => {
    h.reassignTruck.mockRejectedValue(
      new h.SwapNotAllowedError('Pickup day has arrived, so the truck can no longer be swapped.'),
    );
    const res = await switchTruck('b1', 'truck-b');
    await Promise.all(h.pending);

    expect(res).toEqual({ ok: false, error: 'Pickup day has arrived, so the truck can no longer be swapped.' });
    expect(h.notify).not.toHaveBeenCalled();
    expect(h.syncBookingToCalendar).not.toHaveBeenCalled();
  });

  it('passes a clash back the same way', async () => {
    h.reassignTruck.mockRejectedValue(
      new h.NoTruckAvailableError('That truck is already out on those dates (CHT-X).'),
    );
    expect(await switchTruck('b1', 'truck-b')).toEqual({
      ok: false,
      error: 'That truck is already out on those dates (CHT-X).',
    });
  });

  it('gives a plain message, not the stack, for anything unexpected', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.reassignTruck.mockRejectedValue(new Error('connection reset'));
    expect(await switchTruck('b1', 'truck-b')).toEqual({ ok: false, error: 'Could not move that booking.' });
  });
});

const violation = { code: '23P01', message: 'violates exclusion constraint "bookings_no_overlap"' };

/** A booking in the given stage, with its agreements signed and approved unless said otherwise. */
const booking = (stage: string, over: Record<string, unknown> = {}) => ({
  stage,
  pickupDate: new Date('2026-12-20T00:00:00Z'),
  returnDate: new Date('2026-12-22T00:00:00Z'),
  contracts: [{ status: 'SIGNED', counterSignedAt: new Date('2026-11-01T00:00:00Z') }],
  ...over,
});

describe('reopening a booking — the path that used to skip the overlap check', () => {
  it('reopen says the truck is taken instead of crashing', async () => {
    h.reopenBooking.mockRejectedValue(new h.NoTruckAvailableError('That truck has since been booked on those dates.'));
    expect(await reopen('b1')).toEqual({ ok: false, error: 'That truck has since been booked on those dates.' });
  });

  it('reopen also understands a raw database refusal', async () => {
    h.reopenBooking.mockRejectedValue(violation);
    const res = await reopen('b1');
    expect(res.ok).toBe(false);
  });
});

describe('moveCard — one door for dragging and the Move to stage buttons', () => {
  beforeEach(() => {
    h.findBooking.mockResolvedValue(booking('NEW_BOOKING'));
    h.moveBooking.mockResolvedValue(undefined);
    h.syncBookingToCalendar.mockResolvedValue(undefined);
  });

  it('makes an ordinary move, records who and how, and re-syncs the calendar', async () => {
    const res = await moveCard('b1', 'NEW_BOOKING', 'CONTRACT_SENT', 'none', 'drag');
    expect(res).toEqual({ ok: true, message: 'Moved to Contract Sent.' });
    expect(h.moveBooking).toHaveBeenCalledWith('b1', 'NEW_BOOKING', 'CONTRACT_SENT', 'ops', expect.stringContaining('Moved by drag'));
    expect(h.syncBookingToCalendar).toHaveBeenCalledWith('b1');
  });

  it('refuses, changing nothing, when the card is not where the screen showed it', async () => {
    h.findBooking.mockResolvedValue(booking('CONFIRMED'));
    const res = await moveCard('b1', 'NEW_BOOKING', 'CONTRACT_SENT', 'none', 'drag');
    expect(res).toMatchObject({ ok: false, stale: true });
    expect(h.moveBooking).not.toHaveBeenCalled();
  });

  it('turns a race lost inside the move into the same stale answer', async () => {
    h.moveBooking.mockRejectedValue(new h.StaleMoveError('Someone already moved this booking.'));
    expect(await moveCard('b1', 'NEW_BOOKING', 'CONTRACT_SENT', 'none', 'drag')).toMatchObject({ ok: false, stale: true });
  });

  it('asks first, and moves nothing, for a move that needs a yes', async () => {
    h.findBooking.mockResolvedValue(booking('RETURNED'));
    const res = await moveCard('b1', 'RETURNED', 'COMPLETED', 'none', 'drag');
    expect(res).toMatchObject({ ok: false, needs: 'confirm' });
    expect(h.moveBooking).not.toHaveBeenCalled();
  });

  it('moves after the yes, and writes what was confirmed on the booking', async () => {
    h.findBooking.mockResolvedValue(booking('RETURNED'));
    const res = await moveCard('b1', 'RETURNED', 'COMPLETED', 'confirmed', 'drag');
    expect(res.ok).toBe(true);
    expect(h.moveBooking).toHaveBeenCalledWith('b1', 'RETURNED', 'COMPLETED', 'ops', expect.stringContaining('office confirmed'));
  });

  it('refuses Confirmed for an agreement that is not approved, and a plain yes does not get round it', async () => {
    h.findBooking.mockResolvedValue(booking('AWAITING_APPROVAL', { contracts: [{ status: 'SIGNED', counterSignedAt: null }] }));
    expect(await moveCard('b1', 'AWAITING_APPROVAL', 'CONFIRMED', 'none', 'drag')).toMatchObject({ ok: false, needs: 'override' });
    expect(await moveCard('b1', 'AWAITING_APPROVAL', 'CONFIRMED', 'confirmed', 'drag')).toMatchObject({ ok: false, needs: 'override' });
    expect(h.moveBooking).not.toHaveBeenCalled();
  });

  it('allows the override, and records it as one', async () => {
    h.findBooking.mockResolvedValue(booking('AWAITING_APPROVAL', { contracts: [] }));
    const res = await moveCard('b1', 'AWAITING_APPROVAL', 'CONFIRMED', 'override', 'button');
    expect(res.ok).toBe(true);
    expect(h.moveBooking).toHaveBeenCalledWith('b1', 'AWAITING_APPROVAL', 'CONFIRMED', 'ops', expect.stringContaining('office override'));
  });

  it('does not count a void agreement against approval, but needs at least one real one', async () => {
    h.findBooking.mockResolvedValue(
      booking('AWAITING_APPROVAL', {
        contracts: [
          { status: 'VOID', counterSignedAt: null },
          { status: 'SIGNED', counterSignedAt: new Date() },
        ],
      }),
    );
    expect((await moveCard('b1', 'AWAITING_APPROVAL', 'CONFIRMED', 'none', 'drag')).ok).toBe(true);
  });

  it('refuses a drag when dragging is switched off, but still allows the button', async () => {
    const { config } = await import('@/lib/config');
    const spy = vi.spyOn(config, 'boardDrag', 'get').mockReturnValue(false);
    try {
      const dragged = await moveCard('b1', 'NEW_BOOKING', 'CONTRACT_SENT', 'none', 'drag');
      expect(dragged).toMatchObject({ ok: false, error: expect.stringContaining('switched off') });
      expect(h.moveBooking).not.toHaveBeenCalled();
      expect((await moveCard('b1', 'NEW_BOOKING', 'CONTRACT_SENT', 'none', 'button')).ok).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it.each([
    ['not a stage', 'NEW_BOOKING', 'NONSENSE', 'none', 'drag'],
    ['Cancelled is not a column', 'NEW_BOOKING', 'CANCELLED', 'none', 'drag'],
    ['moving from Cancelled', 'CANCELLED', 'CONFIRMED', 'none', 'drag'],
    ['a made-up agreement level', 'NEW_BOOKING', 'CONTRACT_SENT', 'yes', 'drag'],
    ['a made-up way of moving', 'NEW_BOOKING', 'CONTRACT_SENT', 'none', 'hack'],
  ])('refuses %s without touching anything', async (_n, from, to, ack, via) => {
    const res = await moveCard('b1', from, to, ack, via);
    expect(res.ok).toBe(false);
    expect(h.moveBooking).not.toHaveBeenCalled();
  });

  it('says the truck is taken instead of crashing', async () => {
    h.moveBooking.mockRejectedValue(violation);
    const res = await moveCard('b1', 'NEW_BOOKING', 'CONTRACT_SENT', 'none', 'drag');
    expect(res.ok).toBe(false);
    expect(!res.ok && 'error' in res && res.error).toContain('already booked');
  });

  it('lets an unrelated failure surface rather than hiding it', async () => {
    h.moveBooking.mockRejectedValue(new Error('connection reset'));
    await expect(moveCard('b1', 'NEW_BOOKING', 'CONTRACT_SENT', 'none', 'drag')).rejects.toThrow('connection reset');
  });

  it('keeps the move and logs it when only the calendar update fails', async () => {
    h.syncBookingToCalendar.mockRejectedValue(new Error('google down'));
    const res = await moveCard('b1', 'NEW_BOOKING', 'CONTRACT_SENT', 'none', 'drag');
    expect(res.ok).toBe(true);
    expect(h.logEvent).toHaveBeenCalledWith('b1', 'calendar_sync_failed', expect.any(String), 'system');
  });

  it('refuses a booking that does not exist', async () => {
    h.findBooking.mockResolvedValue(null);
    expect(await moveCard('b1', 'NEW_BOOKING', 'CONTRACT_SENT', 'none', 'drag')).toMatchObject({ ok: false });
    expect(h.moveBooking).not.toHaveBeenCalled();
  });
});

describe('cancel — the office decides whether the renter is told', () => {
  it('does not message the renter unless the office said to', async () => {
    h.cancelBooking.mockResolvedValue(undefined);
    await cancel('b1', 'No longer needed');
    expect(h.cancelBooking).toHaveBeenCalledWith('b1', 'No longer needed', 'ops', { tellRenter: false });
  });

  it('tells the renter when the office said to, and says so', async () => {
    h.cancelBooking.mockResolvedValue(undefined);
    const res = await cancel('b1', 'No longer needed', true);
    expect(h.cancelBooking).toHaveBeenCalledWith('b1', 'No longer needed', 'ops', { tellRenter: 'cancelled' });
    expect(res.ok && res.message).toMatch(/renter .*told|renter was told|is being told/i);
  });

  it('only a real true counts: anything else from the browser means do not message', async () => {
    h.cancelBooking.mockResolvedValue(undefined);
    await cancel('b1', 'x', 'true' as never);
    expect(h.cancelBooking).toHaveBeenCalledWith('b1', 'x', 'ops', { tellRenter: false });
  });

  it('says plainly that nobody was messaged when they were not', async () => {
    h.cancelBooking.mockResolvedValue(undefined);
    const res = await cancel('b1', 'x', false);
    expect(res.ok && res.message).toMatch(/not messaged|did not message|no message|nobody was told/i);
  });
});
