import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  update: vi.fn(),
  findUnique: vi.fn(),
  updateManyContracts: vi.fn(),
  logEvent: vi.fn(),
  notify: vi.fn(),
  notifyStaff: vi.fn(),
  sync: vi.fn(),
  removeFromCalendar: vi.fn(),
}));

vi.mock('./db', () => ({
  prisma: {
    booking: { update: h.update, findUnique: h.findUnique },
    contract: { updateMany: h.updateManyContracts },
  },
}));
vi.mock('./notify', () => ({
  logEvent: h.logEvent,
  notify: h.notify,
  notifyStaff: h.notifyStaff,
  setStage: vi.fn(),
}));
vi.mock('./storage', () => ({ markPurgeEligible: vi.fn() }));
vi.mock('./calendar-sync', () => ({
  syncBookingToCalendar: h.sync,
  removeBookingFromCalendar: h.removeFromCalendar,
}));

import { NoTruckAvailableError } from './availability';
import { cancelBooking, reopenBooking } from './bookings';

beforeEach(() => {
  vi.clearAllMocks();
  h.update.mockResolvedValue({});
  h.findUnique.mockResolvedValue({ stage: 'CONFIRMED' });
  h.updateManyContracts.mockResolvedValue({ count: 1 });
  h.notify.mockResolvedValue({ sent: ['SMS', 'EMAIL'], skipped: [], errors: [] });
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

describe('cancelBooking — telling the renter', () => {
  it('cancels, voids the unsigned paperwork, tells the office and clears the calendar, as before', async () => {
    await cancelBooking('b1', 'No longer needed', 'ops');
    expect(h.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'b1' }, data: expect.objectContaining({ stage: 'CANCELLED' }) }),
    );
    expect(h.updateManyContracts).toHaveBeenCalled();
    expect(h.notifyStaff).toHaveBeenCalledWith('b1', 'cancelled', { detail: 'No longer needed' });
    expect(h.removeFromCalendar).toHaveBeenCalledWith('b1');
  });

  it('does not message the renter unless asked to', async () => {
    await cancelBooking('b1', 'x', 'ops');
    expect(h.notify).not.toHaveBeenCalled();
  });

  it('tells the renter it is cancelled when the office chose to', async () => {
    await cancelBooking('b1', 'x', 'ops', { tellRenter: 'cancelled' });
    expect(h.notify).toHaveBeenCalledWith('b1', 'booking_cancelled', { force: true });
    expect(h.logEvent).toHaveBeenCalledWith('b1', 'renter_told', expect.stringMatching(/sms/i), 'ops');
  });

  it('uses the released wording when the system let the truck go for want of a signature', async () => {
    h.findUnique.mockResolvedValue({ stage: 'CONTRACT_SENT' });
    await cancelBooking('b1', 'Auto-released', 'system', { tellRenter: 'released' });
    expect(h.notify).toHaveBeenCalledWith('b1', 'booking_released', { force: true });
  });

  it('tells them after the cancellation has happened, never before', async () => {
    await cancelBooking('b1', 'x', 'ops', { tellRenter: 'cancelled' });
    expect(h.update.mock.invocationCallOrder[0]).toBeLessThan(h.notify.mock.invocationCallOrder[0]);
  });

  it('does not tell someone who already has the truck, even if asked, but still cancels', async () => {
    h.findUnique.mockResolvedValue({ stage: 'IN_USE' });
    await cancelBooking('b1', 'x', 'ops', { tellRenter: 'cancelled' });
    expect(h.update).toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
  });

  it('does nothing at all to a booking that is already cancelled: no second alert, no second message', async () => {
    h.findUnique.mockResolvedValue({ stage: 'CANCELLED' });
    await cancelBooking('b1', 'x', 'ops', { tellRenter: 'cancelled' });
    expect(h.update).not.toHaveBeenCalled();
    expect(h.notifyStaff).not.toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
  });

  it('refuses a booking that does not exist', async () => {
    h.findUnique.mockResolvedValue(null);
    await expect(cancelBooking('nope', 'x', 'ops')).rejects.toThrow(/not found/i);
    expect(h.update).not.toHaveBeenCalled();
  });

  it('keeps the cancellation when the message could not be sent, and records that the renter was not told', async () => {
    h.notify.mockResolvedValue({ sent: [], skipped: [], errors: ['SMS: Cannot send message as DND is active for SMS.'] });
    await expect(cancelBooking('b1', 'x', 'ops', { tellRenter: 'cancelled' })).resolves.toBeUndefined();
    expect(h.logEvent).toHaveBeenCalledWith('b1', 'notify_failed', expect.stringMatching(/DND/), 'ops');
    expect(h.logEvent).not.toHaveBeenCalledWith('b1', 'renter_told', expect.anything(), expect.anything());
  });

  it('keeps the cancellation even if sending throws', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.notify.mockRejectedValue(new Error('GHL down'));
    await expect(cancelBooking('b1', 'x', 'ops', { tellRenter: 'cancelled' })).resolves.toBeUndefined();
    expect(h.removeFromCalendar).toHaveBeenCalled();
    expect(h.logEvent).toHaveBeenCalledWith('b1', 'notify_failed', expect.stringMatching(/GHL down/), 'ops');
    quiet.mockRestore();
  });
});
