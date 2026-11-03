import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ updateMany: vi.fn(), findMany: vi.fn() }));
vi.mock('./db', () => ({ prisma: { messageLog: { updateMany: mocks.updateMany, findMany: mocks.findMany } } }));

import { MAX_HANDLED_AT_ONCE, handledFilter, markHandled, openFailures } from './failure-handling';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateMany.mockResolvedValue({ count: 2 });
});

describe('markHandled', () => {
  it('stamps who dealt with it and when, but only on messages that failed and are still open', async () => {
    const r = await markHandled(['a', 'b'], 'ops');
    expect(r).toEqual({ ok: true, count: 2 });
    const arg = mocks.updateMany.mock.calls[0][0] as { where: Record<string, unknown>; data: Record<string, unknown> };
    expect(arg.where).toEqual({ id: { in: ['a', 'b'] }, status: 'FAILED', handledAt: null });
    expect(arg.data.handledBy).toBe('ops');
    expect(arg.data.handledAt).toBeInstanceOf(Date);
  });

  it('never deletes anything, and never touches the error text', async () => {
    await markHandled(['a'], 'ops');
    const arg = mocks.updateMany.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(Object.keys(arg.data).sort()).toEqual(['handledAt', 'handledBy']);
  });

  it('reports how many it actually changed, not how many it was asked about', async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    expect(await markHandled(['a', 'b', 'c'], 'ops')).toEqual({ ok: true, count: 1 });
  });

  it.each([undefined, null, 'a', 5, {}, [], [1], [''], [null]])('refuses %j', async (bad) => {
    const r = await markHandled(bad, 'ops');
    expect(r.ok).toBe(false);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it('refuses an absurd number at once, so one request cannot sweep the whole log', async () => {
    const many = Array.from({ length: MAX_HANDLED_AT_ONCE + 1 }, (_, i) => `id${i}`);
    expect((await markHandled(many, 'ops')).ok).toBe(false);
    expect((await markHandled(many.slice(0, MAX_HANDLED_AT_ONCE), 'ops')).ok).toBe(true);
  });

  it('ignores duplicate ids', async () => {
    await markHandled(['a', 'a', 'b'], 'ops');
    const arg = mocks.updateMany.mock.calls[0][0] as { where: { id: { in: string[] } } };
    expect(arg.where.id.in).toEqual(['a', 'b']);
  });
});

describe('handledFilter and openFailures', () => {
  it('hides handled failures by default and shows only them on request', () => {
    expect(handledFilter(false)).toEqual({ status: 'FAILED', handledAt: null });
    expect(handledFilter(true)).toEqual({ status: 'FAILED', handledAt: { not: null } });
  });

  it('lists open failures newest first, with the booking it belongs to', async () => {
    mocks.findMany.mockResolvedValue([]);
    await openFailures(false);
    const arg = mocks.findMany.mock.calls[0][0] as { where: unknown; orderBy: unknown; include: Record<string, unknown> };
    expect(arg.where).toEqual({ status: 'FAILED', handledAt: null });
    expect(arg.orderBy).toEqual({ createdAt: 'desc' });
    expect(arg.include).toHaveProperty('booking');
  });
});
