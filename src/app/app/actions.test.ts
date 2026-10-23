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
vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/bookings', () => ({
  cancelBooking: vi.fn(),
  completeBooking: vi.fn(),
  reopenBooking: h.reopenBooking,
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// Run the post-response work for real, and keep hold of it so a test can wait.
vi.mock('next/server', () => ({ after: (fn: () => Promise<unknown>) => h.pending.push(fn()) }));

import { moveStage, reopen, switchTruck } from './actions';

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

describe('moving a card or reopening a booking — the two paths that used to skip the overlap check', () => {
  const violation = { code: '23P01', message: 'violates exclusion constraint "bookings_no_overlap"' };

  it('moveStage says the truck is taken instead of crashing', async () => {
    h.setStage.mockRejectedValue(violation);
    const res = await moveStage('b1', 'CONTRACT_SENT');
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toContain('already booked');
  });

  it('reopen says the truck is taken instead of crashing', async () => {
    h.reopenBooking.mockRejectedValue(new h.NoTruckAvailableError('That truck has since been booked on those dates.'));
    expect(await reopen('b1')).toEqual({ ok: false, error: 'That truck has since been booked on those dates.' });
  });

  it('reopen also understands a raw database refusal', async () => {
    h.reopenBooking.mockRejectedValue(violation);
    const res = await reopen('b1');
    expect(res.ok).toBe(false);
  });

  it('moveStage still succeeds normally', async () => {
    h.setStage.mockResolvedValue('CONFIRMED');
    expect((await moveStage('b1', 'CONFIRMED')).ok).toBe(true);
  });

  it('moveStage lets an unrelated failure surface rather than hiding it', async () => {
    h.setStage.mockRejectedValue(new Error('connection reset'));
    await expect(moveStage('b1', 'CONFIRMED')).rejects.toThrow('connection reset');
  });
});
