import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  findChecklist: vi.fn(),
  updateMany: vi.fn(),
  setStage: vi.fn(),
  logEvent: vi.fn(),
  notify: vi.fn(),
  notifyStaff: vi.fn(),
}));

vi.mock('./db', () => ({
  prisma: {
    checklist: { findUnique: h.findChecklist, updateMany: h.updateMany },
    document: { findMany: vi.fn().mockResolvedValue([]) },
    booking: { update: vi.fn() },
  },
}));
vi.mock('./notify', () => ({
  setStage: h.setStage,
  logEvent: h.logEvent,
  notify: h.notify,
  notifyStaff: h.notifyStaff,
}));
vi.mock('./checklist-steps', () => ({ buildSteps: () => [], SLOT_KINDS: [] }));

import { completeChecklist } from './checklist-completion';

const input = {
  checklistId: 'k1',
  source: 'RENTER' as const,
  actor: 'renter',
  reportedTime: '10:00',
  overrideReason: 'test',
};

const checklist = (stage: string, over: Record<string, unknown> = {}) => ({
  id: 'k1',
  bookingId: 'b1',
  phase: 'DROPOFF',
  submittedAt: null,
  booking: { id: 'b1', stage, firstName: 'A', lastName: 'B', email: 'a@b.co', phone: '+1' },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.updateMany.mockResolvedValue({ count: 1 });
});

describe('completeChecklist — a closed booking cannot be dragged back open', () => {
  it.each(['CANCELLED', 'COMPLETED'])('refuses a %s booking before claiming the checklist', async (stage) => {
    h.findChecklist.mockResolvedValue(checklist(stage));
    await expect(completeChecklist(input)).rejects.toThrow(/cancelled|closed/i);
    expect(h.updateMany).not.toHaveBeenCalled();
    expect(h.setStage).not.toHaveBeenCalled();
  });

  it('says a completed booking is closed, not cancelled', async () => {
    h.findChecklist.mockResolvedValue(checklist('COMPLETED'));
    await expect(completeChecklist(input)).rejects.toThrow(/closed/i);
  });

  it('still completes a return for a booking that is in use', async () => {
    h.findChecklist.mockResolvedValue(checklist('IN_USE'));
    const res = await completeChecklist(input);
    expect(res).toMatchObject({ alreadySubmitted: false });
    expect(h.setStage).toHaveBeenCalledWith('b1', 'RETURNED', 'renter', expect.any(String));
  });
});
