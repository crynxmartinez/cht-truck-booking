import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted above everything else in the file, so anything
// they refer to has to be created with vi.hoisted or it does not exist yet.
const h = vi.hoisted(() => ({
  reassignTruck: vi.fn(),
  notify: vi.fn(),
  notifyStaff: vi.fn(),
  logEvent: vi.fn(),
  syncBookingToCalendar: vi.fn(),
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
  setStage: vi.fn(),
}));
vi.mock('@/lib/calendar-sync', () => ({ syncBookingToCalendar: h.syncBookingToCalendar }));
vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/bookings', () => ({ cancelBooking: vi.fn(), completeBooking: vi.fn(), reopenBooking: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// Run the post-response work for real, and keep hold of it so a test can wait.
vi.mock('next/server', () => ({ after: (fn: () => Promise<unknown>) => h.pending.push(fn()) }));

import { switchTruck } from './actions';

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
