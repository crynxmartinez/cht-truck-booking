import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  upsert: vi.fn((a: unknown) => ({ op: 'upsert', a })),
  deleteMany: vi.fn((a: unknown) => ({ op: 'deleteMany', a })),
  create: vi.fn((a: unknown) => ({ op: 'create', a })),
  transaction: vi.fn(async (ops: unknown[]) => ops),
}));

vi.mock('./db', () => ({
  prisma: {
    setting: {
      findMany: mocks.findMany,
      upsert: mocks.upsert,
      deleteMany: mocks.deleteMany,
      create: mocks.create,
    },
    $transaction: mocks.transaction,
  },
}));

import { config } from './config';
import { loadSettings, recentChanges, saveSettings } from './settings';
import { applySettings } from './settings-store';

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-02T18:00:00Z'));
  mocks.findMany.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
  applySettings({});
});

describe('loadSettings', () => {
  it('puts what is stored into effect', async () => {
    mocks.findMany.mockResolvedValue([{ key: 'cfg.minLeadDays', value: '4' }]);
    await loadSettings({ force: true });
    expect(config.minLeadDays).toBe(4);
  });

  it('asks the database only once in a short while', async () => {
    await loadSettings({ force: true });
    await loadSettings();
    await loadSettings();
    expect(mocks.findMany).toHaveBeenCalledTimes(1);
  });

  it('asks again once the short while has passed', async () => {
    await loadSettings({ force: true });
    vi.advanceTimersByTime(11_000);
    await loadSettings();
    expect(mocks.findMany).toHaveBeenCalledTimes(2);
  });

  it('keeps the app running on the built-in values if the database cannot be read', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.findMany.mockRejectedValue(new Error('connection reset'));
    await expect(loadSettings({ force: true })).resolves.toBeUndefined();
    expect(config.minLeadDays).toBeGreaterThanOrEqual(0);
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
  });
});

describe('saveSettings', () => {
  it('writes a valid change and a history entry saying who changed what', async () => {
    const r = await saveSettings({ minLeadDays: '3' }, 'ops');
    expect(r).toMatchObject({ ok: true, changed: 1 });
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: 'cfg.minLeadDays' }, update: { value: '3' } }),
    );
    const log = mocks.create.mock.calls[0][0] as { data: { key: string; value: string } };
    expect(log.data.key).toMatch(/^log\.\d+\.minLeadDays$/);
    expect(JSON.parse(log.data.value)).toEqual({ from: 1, to: 3, by: 'ops' });
  });

  it('writes everything in one transaction, so a failure cannot leave half of it applied', async () => {
    await saveSettings({ minLeadDays: '3', returnSmsHour: '8' }, 'ops');
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect((mocks.transaction.mock.calls[0][0] as unknown[]).length).toBe(4); // 2 settings + 2 history rows
  });

  it('writes nothing at all when any value is refused', async () => {
    const r = await saveSettings({ minLeadDays: '3', pickupSmsHour: '99' }, 'ops');
    expect(r.ok).toBe(false);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('puts a setting back to its default by deleting it, and records that', async () => {
    mocks.findMany.mockResolvedValue([{ key: 'cfg.minLeadDays', value: '5' }]);
    const r = await saveSettings({ minLeadDays: null }, 'ops');
    expect(r).toMatchObject({ ok: true, changed: 1 });
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { key: 'cfg.minLeadDays' } });
    const log = mocks.create.mock.calls[0][0] as { data: { value: string } };
    expect(JSON.parse(log.data.value)).toEqual({ from: 5, to: null, by: 'ops' });
  });

  it('says so, and writes nothing, when nothing actually changed', async () => {
    const r = await saveSettings({ minLeadDays: String(config.minLeadDays) }, 'ops');
    expect(r).toMatchObject({ ok: true, changed: 0 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('takes effect straight away, without waiting for the short cache to expire', async () => {
    mocks.findMany
      .mockResolvedValueOnce([]) // read before planning
      .mockResolvedValueOnce([{ key: 'cfg.minLeadDays', value: '3' }]); // read after writing
    await saveSettings({ minLeadDays: '3' }, 'ops');
    expect(config.minLeadDays).toBe(3);
  });
});

describe('recentChanges', () => {
  it('lists the newest first, with a readable name for each setting', async () => {
    mocks.findMany.mockResolvedValue([
      { key: 'log.1730570000000.returnSmsHour', value: JSON.stringify({ from: 7, to: 8, by: 'ops' }) },
      { key: 'log.1730560000000.minLeadDays', value: JSON.stringify({ from: 1, to: null, by: 'ops' }) },
    ]);
    const rows = await recentChanges(10);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ key: 'returnSmsHour', from: '7 AM', to: '8 AM', by: 'ops' });
    expect(rows[1].to).toMatch(/default/i);
  });

  it('skips a history row it cannot read instead of failing the page', async () => {
    mocks.findMany.mockResolvedValue([
      { key: 'log.1.minLeadDays', value: 'not json' },
      { key: 'log.2.nonsense', value: JSON.stringify({ from: 1, to: 2, by: 'ops' }) },
    ]);
    await expect(recentChanges(10)).resolves.toEqual([]);
  });
});
