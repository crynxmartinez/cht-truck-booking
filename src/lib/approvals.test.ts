import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  findContract: vi.fn(),
  updateContract: vi.fn(),
  countContracts: vi.fn(),
  mainAdmins: vi.fn(),
  setStage: vi.fn(),
  logEvent: vi.fn(),
  notify: vi.fn(),
  notifyStaff: vi.fn(),
}));

vi.mock('./db', () => ({
  prisma: {
    contract: { findUnique: h.findContract, updateMany: h.updateContract, count: h.countContracts },
  },
}));
vi.mock('./notify', () => ({
  mainAdmins: h.mainAdmins,
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
  h.mainAdmins.mockResolvedValue([{ id: 'a1', name: 'Diana', email: 'd@x.co', signatureData: 'data:image/png;base64,xx' }]);
  h.countContracts.mockResolvedValue(0);
  h.updateContract.mockResolvedValue({ count: 1 });
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

describe('approveContract — two people approving at the same moment', () => {
  it('only lets the first signature stand: the write is conditional on nobody having signed yet', async () => {
    h.findContract.mockResolvedValue(contract('AWAITING_APPROVAL'));
    await approveContract('c1');
    const arg = h.updateContract.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(arg.where).toEqual({ id: 'c1', counterSignedAt: null });
  });

  it('when the other person got there first, changes nothing, logs nothing, and says it is already signed', async () => {
    h.findContract.mockResolvedValue(contract('AWAITING_APPROVAL'));
    h.updateContract.mockResolvedValue({ count: 0 });
    expect(await approveContract('c1')).toEqual({ alreadySigned: true, bookingId: 'b1' });
    expect(h.logEvent).not.toHaveBeenCalled();
    expect(h.setStage).not.toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
  });
});

describe('approveContract — several main admins', () => {
  const diana = { id: 'a1', name: 'Diana', email: 'd@x.co', signatureData: 'data:image/png;base64,DIANA' };
  const dana = { id: 'a2', name: 'Dana', email: 'dana@x.co', signatureData: 'data:image/png;base64,DANA' };
  const sam = { id: 'a3', name: 'Sam', email: 's@x.co', signatureData: null };

  beforeEach(() => {
    h.mainAdmins.mockResolvedValue([diana, dana, sam]);
    h.findContract.mockResolvedValue(contract('AWAITING_APPROVAL'));
  });

  it('stamps the signature of the person who was chosen, not the first on the list', async () => {
    await approveContract('c1', 'a2');
    const data = (h.updateContract.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({
      counterSignedById: 'a2',
      counterSignerName: 'Dana',
      counterSignatureData: 'data:image/png;base64,DANA',
    });
    expect(data.counterSignatureData).not.toContain('DIANA');
  });

  it('records who approved in the booking history', async () => {
    await approveContract('c1', 'a2');
    expect(h.logEvent).toHaveBeenCalledWith('b1', 'contract_countersigned', expect.stringContaining('Dana'), 'dana@x.co');
  });

  it('refuses to guess when there are several and nobody was named, and signs nothing', async () => {
    await expect(approveContract('c1')).rejects.toThrow(/choose who/i);
    expect(h.updateContract).not.toHaveBeenCalled();
    expect(h.setStage).not.toHaveBeenCalled();
  });

  it('refuses someone who is not on the main admin list', async () => {
    await expect(approveContract('c1', 'stranger')).rejects.toThrow(/not a main admin/i);
    expect(h.updateContract).not.toHaveBeenCalled();
  });

  it('refuses a main admin who has not drawn a signature yet', async () => {
    await expect(approveContract('c1', 'a3')).rejects.toThrow(/Sam has no signature/);
    expect(h.updateContract).not.toHaveBeenCalled();
  });
});
