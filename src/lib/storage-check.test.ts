import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(async () => undefined),
}));

vi.mock('./db', () => ({ prisma: { setting: { findUnique: mocks.findUnique, upsert: mocks.upsert } } }));

import { runStorageCheck } from './storage-check';

const GB = 1024 ** 3;
const reading = (pct: number) => ({ totalBytes: Math.round((pct / 100) * GB), quotaBytes: GB, pct, blobCount: 10 });

function deps(pct: number, notifyResult = { sent: 2, failed: 0 }) {
  return {
    configured: () => true,
    measure: vi.fn(async () => reading(pct)),
    notify: vi.fn(async () => notifyResult),
    deletionEnabled: () => false,
  };
}

/** What was stored under a key, read back from the upsert calls. */
function storedValue(key: string): string | undefined {
  const calls = mocks.upsert.mock.calls as unknown as Array<[{ where: { key: string }; update: { value: string } }]>;
  return calls.find((c) => c[0].where.key === key)?.[0].update.value;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findUnique.mockResolvedValue(null); // nothing announced before
});

describe('runStorageCheck', () => {
  it('does nothing when storage is not connected', async () => {
    const d = { ...deps(50), configured: () => false };
    const out = await runStorageCheck(d);
    expect(out).toMatchObject({ skipped: expect.any(String) });
    expect(d.measure).not.toHaveBeenCalled();
  });

  it('stores the reading for the banner and stays quiet when there is plenty of room', async () => {
    const d = deps(12.5);
    const out = await runStorageCheck(d);
    expect(d.notify).not.toHaveBeenCalled();
    expect(out).toMatchObject({ level: 'ok', alerted: false });
    const state = JSON.parse(storedValue('state.storage')!);
    expect(state).toMatchObject({ level: 'ok', quotaBytes: GB });
    expect(state.pct).toBeCloseTo(12.5, 1);
  });

  it('emails the office the first time it passes 70%, and remembers it did', async () => {
    const d = deps(72);
    const out = await runStorageCheck(d);
    expect(d.notify).toHaveBeenCalledTimes(1);
    const [subject, body] = d.notify.mock.calls[0] as unknown as [string, string];
    expect(subject).toMatch(/72%/);
    expect(body).toMatch(/Settings/);
    expect(out).toMatchObject({ level: 'warn', alerted: true });
    expect(storedValue('state.storageAlerted')).toBe('warn');
  });

  it('does not repeat the alert while it stays at the same level', async () => {
    mocks.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) =>
      where.key === 'state.storageAlerted' ? { value: 'warn' } : null,
    );
    const d = deps(75);
    const out = await runStorageCheck(d);
    expect(d.notify).not.toHaveBeenCalled();
    expect(out).toMatchObject({ alerted: false });
  });

  it('alerts again, urgently, at 90%', async () => {
    mocks.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) =>
      where.key === 'state.storageAlerted' ? { value: 'warn' } : null,
    );
    const d = deps(91);
    await runStorageCheck(d);
    expect(d.notify).toHaveBeenCalledTimes(1);
    const [subject, , options] = d.notify.mock.calls[0] as unknown as [string, string, { urgent?: boolean; sms?: string }];
    expect(subject).toMatch(/urgent/i);
    expect(options.urgent).toBe(true);
    expect(options.sms).toBeTruthy();
  });

  it('does not count an alert as given if nobody could be reached, so it tries again tomorrow', async () => {
    const d = deps(72, { sent: 0, failed: 2 });
    const out = await runStorageCheck(d);
    expect(out).toMatchObject({ alerted: false });
    expect(storedValue('state.storageAlerted')).toBeUndefined();
  });

  it('forgets a level once storage improves, so crossing it again is news again', async () => {
    mocks.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) =>
      where.key === 'state.storageAlerted' ? { value: 'warn' } : null,
    );
    await runStorageCheck(deps(40));
    expect(storedValue('state.storageAlerted')).toBe('ok');
  });

  it('reports a failure to measure instead of throwing', async () => {
    const d = { ...deps(10), measure: vi.fn(async () => { throw new Error('blob unavailable'); }) };
    const out = await runStorageCheck(d);
    expect(out).toMatchObject({ error: expect.stringContaining('blob unavailable') });
  });
});
