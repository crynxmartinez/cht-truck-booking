import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  findContract: vi.fn(),
  updateContract: vi.fn(),
  countContracts: vi.fn(),
  mainAdmin: vi.fn(),
  setStage: vi.fn(),
  logEvent: vi.fn(),
  notify: vi.fn(),
  notifyStaff: vi.fn(),
}));

vi.mock('./db', () => ({
  prisma: {
    contract: { findUnique: h.findContract, update: h.updateContract, count: h.countContracts },
  },
}));
vi.mock('./notify', () => ({
  mainAdmin: h.mainAdmin,
  setStage: h.setStage,
  logEvent: h.logEvent,
  notify: h.notify,
  notifyStaff: h.notifyStaff,
}));
vi.mock('./calendar-sync', () => ({ syncBookingToCalendar: vi.fn() }));
vi.mock('./pickup-release', () => ({ sendDuePickupMessage: vi.fn().mockResolvedValue(null) }));

import { ApprovalError, approveContract } from './approvals';

const contract = (stage: string, over: Record<string, unknown> = {}) => ({
  id: 'c1',
  type: 'RENTAL_AGREEMENT',
  status: 'SIGNED',
  counterSignedAt: null,
  booking: { id: 'b1', stage, reference: 'CHT-X' },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.mainAdmin.mockResolvedValue({ id: 'a1', name: 'Diana', email: 'd@x.co', signatureData: 'data:image/png;base64,xx' });
  h.countContracts.mockResolvedValue(0);
  h.updateContract.mockResolvedValue({});
  h.notify.mockResolvedValue({ sent: [], skipped: [], errors: [] });
});

describe('approveContract — only a live booking can be confirmed', () => {
  it.each(['CANCELLED', 'COMPLETED'])(
    'refuses a %s booking and signs nothing, rather than bringing it back as Confirmed',
    async (stage) => {
      h.findContract.mockResolvedValue(contract(stage));
      await expect(approveContract('c1')).rejects.toBeInstanceOf(ApprovalError);
      expect(h.updateContract).not.toHaveBeenCalled();
      expect(h.setStage).not.toHaveBeenCalled();
    },
  );

  it('says why, in words the office can act on', async () => {
    h.findContract.mockResolvedValue(contract('CANCELLED'));
    await expect(approveContract('c1')).rejects.toThrow(/cancelled/i);
  });

  it('still approves a booking waiting on the main admin and confirms it', async () => {
    h.findContract.mockResolvedValue(contract('AWAITING_APPROVAL'));
    const res = await approveContract('c1');
    expect(h.updateContract).toHaveBeenCalled();
    expect(h.setStage).toHaveBeenCalledWith('b1', 'CONFIRMED', 'd@x.co', expect.any(String));
    expect(res).toMatchObject({ alreadySigned: false, confirmed: true });
  });

  it('reports an agreement that was already counter-signed without touching the booking', async () => {
    h.findContract.mockResolvedValue(contract('CANCELLED', { counterSignedAt: new Date() }));
    expect(await approveContract('c1')).toEqual({ alreadySigned: true, bookingId: 'b1' });
    expect(h.updateContract).not.toHaveBeenCalled();
  });
});
