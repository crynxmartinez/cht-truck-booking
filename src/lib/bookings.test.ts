import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  update: vi.fn(),
  logEvent: vi.fn(),
  sync: vi.fn(),
}));

vi.mock('./db', () => ({ prisma: { booking: { update: h.update } } }));
vi.mock('./notify', () => ({
  logEvent: h.logEvent,
  notifyStaff: vi.fn(),
  setStage: vi.fn(),
}));
vi.mock('./storage', () => ({ markPurgeEligible: vi.fn() }));
vi.mock('./calendar-sync', () => ({
  syncBookingToCalendar: h.sync,
  removeBookingFromCalendar: vi.fn(),
}));

import { NoTruckAvailableError } from './availability';
import { reopenBooking } from './bookings';

beforeEach(() => {
  vi.clearAllMocks();
  h.update.mockResolvedValue({});
});

describe('reopenBooking', () => {
  it('puts the booking back in play, logs it, and puts it back on the calendar', async () => {
    await reopenBooking('b1', 'ops');
    expect(h.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'b1' }, data: expect.objectContaining({ stage: 'CONTRACT_SENT' }) }),
    );
    expect(h.logEvent).toHaveBeenCalledWith('b1', 'reopened', expect.any(String), 'ops');
    expect(h.sync).toHaveBeenCalledWith('b1');
  });

  it('refuses, in plain words, when the truck has been booked in the meantime', async () => {
    h.update.mockRejectedValue({ code: '23P01', message: 'violates exclusion constraint "bookings_no_overlap"' });
    const attempt = reopenBooking('b1', 'ops');
    await expect(attempt).rejects.toBeInstanceOf(NoTruckAvailableError);
    await expect(attempt).rejects.toThrow(/cannot be reopened/);
    expect(h.logEvent).not.toHaveBeenCalled();
    expect(h.sync).not.toHaveBeenCalled();
  });

  it('lets an unrelated failure through untouched', async () => {
    h.update.mockRejectedValue(new Error('connection reset'));
    await expect(reopenBooking('b1', 'ops')).rejects.toThrow('connection reset');
  });
});
