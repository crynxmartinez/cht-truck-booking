import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  update: vi.fn(),
  updateMany: vi.fn(),
  findUnique: vi.fn(),
  updateManyContracts: vi.fn(),
  logEvent: vi.fn(),
  notify: vi.fn(),
  notifyStaff: vi.fn(),
  sync: vi.fn(),
  removeFromCalendar: vi.fn(),
  updateManyDocuments: vi.fn(),
  markPurge: vi.fn(),
}));

vi.mock('./db', () => {
  const tables = {
    booking: { update: h.update, updateMany: h.updateMany, findUnique: h.findUnique },
    contract: { updateMany: h.updateManyContracts },
    document: { updateMany: h.updateManyDocuments },
  };
  return { prisma: { ...tables, $transaction: (fn: (tx: typeof tables) => unknown) => fn(tables) } };
});
vi.mock('./notify', () => ({
  logEvent: h.logEvent,
  notify: h.notify,
  notifyStaff: h.notifyStaff,
  setStage: vi.fn(),
}));
vi.mock('./storage', () => ({ markPurgeEligible: h.markPurge }));
vi.mock('./calendar-sync', () => ({
  syncBookingToCalendar: h.sync,
  removeBookingFromCalendar: h.removeFromCalendar,
}));

import { NoTruckAvailableError } from './availability';
import { cancelBooking, moveBooking, reopenBooking, StaleMoveError } from './bookings';

beforeEach(() => {
  vi.clearAllMocks();
  h.update.mockResolvedValue({});
  h.updateMany.mockResolvedValue({ count: 1 });
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
    expect(h.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'b1' }), data: expect.objectContaining({ stage: 'CANCELLED' }) }),
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
    expect(h.updateMany.mock.invocationCallOrder[0]).toBeLessThan(h.notify.mock.invocationCallOrder[0]);
  });

  it('does not tell someone who already has the truck, even if asked, but still cancels', async () => {
    h.findUnique.mockResolvedValue({ stage: 'IN_USE' });
    await cancelBooking('b1', 'x', 'ops', { tellRenter: 'cancelled' });
    expect(h.updateMany).toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
  });

  it('does nothing at all to a booking that is already cancelled: no second alert, no second message', async () => {
    h.findUnique.mockResolvedValue({ stage: 'CANCELLED' });
    await cancelBooking('b1', 'x', 'ops', { tellRenter: 'cancelled' });
    expect(h.updateMany).not.toHaveBeenCalled();
    expect(h.notifyStaff).not.toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
  });

  it('refuses a booking that does not exist', async () => {
    h.findUnique.mockResolvedValue(null);
    await expect(cancelBooking('nope', 'x', 'ops')).rejects.toThrow(/not found/i);
    expect(h.updateMany).not.toHaveBeenCalled();
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

describe('cancelBooking — two things happening at the same moment', () => {
  it('only cancels a booking that is not already cancelled, in the write itself', async () => {
    await cancelBooking('b1', 'x', 'ops');
    const arg = h.updateMany.mock.calls[0][0] as { where: { id: string; stage: unknown } };
    expect(arg.where).toEqual({ id: 'b1', stage: { not: 'CANCELLED' } });
  });

  it('does nothing further when somebody else cancelled it a moment ago: no alert, no message, no calendar change', async () => {
    h.updateMany.mockResolvedValue({ count: 0 });
    await cancelBooking('b1', 'x', 'ops', { tellRenter: 'cancelled' });
    expect(h.updateManyContracts).not.toHaveBeenCalled();
    expect(h.notifyStaff).not.toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
    expect(h.removeFromCalendar).not.toHaveBeenCalled();
    expect(h.logEvent).not.toHaveBeenCalled();
  });

  it('can be told to cancel only if the booking is still in the stages it was chosen for', async () => {
    await cancelBooking('b1', 'Auto-released', 'system', {
      tellRenter: 'released',
      onlyIfStageIn: ['CONTRACT_SENT', 'ADDITIONAL_DRIVER'],
    });
    const arg = h.updateMany.mock.calls[0][0] as { where: { stage: unknown } };
    expect(arg.where.stage).toEqual({ in: ['CONTRACT_SENT', 'ADDITIONAL_DRIVER'] });
  });

  it('leaves a renter alone who signed after the sweep picked their booking, and says nothing to them', async () => {
    // The sweep chose it while it was unsigned; by the time it gets there it has moved on.
    h.updateMany.mockResolvedValue({ count: 0 });
    await cancelBooking('b1', 'Auto-released', 'system', {
      tellRenter: 'released',
      onlyIfStageIn: ['CONTRACT_SENT', 'ADDITIONAL_DRIVER'],
    });
    expect(h.notify).not.toHaveBeenCalled();
    expect(h.notifyStaff).not.toHaveBeenCalled();
  });
});

describe('moveBooking', () => {
  it('moves only if the booking is still in the stage the screen showed', async () => {
    await moveBooking('b1', 'CONFIRMED' as never, 'PICKUP_DAY' as never, 'ops', 'Moved by drag');
    expect(h.updateMany).toHaveBeenCalledWith({ where: { id: 'b1', stage: 'CONFIRMED' }, data: { stage: 'PICKUP_DAY' } });
    expect(h.logEvent).toHaveBeenCalledWith('b1', 'stage_change', 'Moved by drag', 'ops', { from: 'CONFIRMED', to: 'PICKUP_DAY' });
  });

  it('refuses, and logs nothing, when someone else moved it first', async () => {
    h.updateMany.mockResolvedValue({ count: 0 });
    await expect(moveBooking('b1', 'CONFIRMED' as never, 'PICKUP_DAY' as never, 'ops', 'x')).rejects.toBeInstanceOf(StaleMoveError);
    expect(h.logEvent).not.toHaveBeenCalled();
    expect(h.markPurge).not.toHaveBeenCalled();
  });

  it('does nothing for a drop on the same column', async () => {
    await moveBooking('b1', 'CONFIRMED' as never, 'CONFIRMED' as never, 'ops', 'x');
    expect(h.updateMany).not.toHaveBeenCalled();
    expect(h.logEvent).not.toHaveBeenCalled();
  });

  it('closes out exactly as completing does when moved into Completed', async () => {
    await moveBooking('b1', 'RETURNED' as never, 'COMPLETED' as never, 'ops', 'x');
    expect(h.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'b1' }, data: expect.objectContaining({ completedAt: expect.any(Date), overdue: false }) }),
    );
    expect(h.markPurge).toHaveBeenCalledWith('b1');
  });

  it('stops the removal clock and clears the closed date when moved out of Completed', async () => {
    await moveBooking('b1', 'COMPLETED' as never, 'RETURNED' as never, 'ops', 'x');
    expect(h.update).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { completedAt: null } });
    expect(h.updateManyDocuments).toHaveBeenCalledWith({ where: { bookingId: 'b1' }, data: { purgeEligibleAt: null } });
    expect(h.markPurge).not.toHaveBeenCalled();
  });

  it('still finishes the move and logs it when the removal dates cannot be set', async () => {
    h.markPurge.mockRejectedValue(new Error('db hiccup'));
    await moveBooking('b1', 'RETURNED' as never, 'COMPLETED' as never, 'ops', 'x');
    expect(h.logEvent).toHaveBeenCalledWith('b1', 'purge_clock_failed', expect.any(String), 'system');
    expect(h.logEvent).toHaveBeenCalledWith('b1', 'stage_change', 'x', 'ops', { from: 'RETURNED', to: 'COMPLETED' });
  });

  it('leaves files alone on an ordinary move', async () => {
    await moveBooking('b1', 'NEW_BOOKING' as never, 'CONTRACT_SENT' as never, 'ops', 'x');
    expect(h.updateManyDocuments).not.toHaveBeenCalled();
    expect(h.markPurge).not.toHaveBeenCalled();
  });
});
