import { describe, expect, it, vi } from 'vitest';
import {
  STORAGE_URGENT_PCT,
  STORAGE_WARN_PCT,
  alertDecision,
  formatBytes,
  parseStorageState,
  storageAlertText,
  storageLevel,
  storageSweep,
} from './storage-alert';

describe('storageLevel', () => {
  it('is fine below 70%', () => {
    expect(storageLevel(0)).toBe('ok');
    expect(storageLevel(69.99)).toBe('ok');
  });

  it('warns from 70% and is urgent from 90%', () => {
    expect(STORAGE_WARN_PCT).toBe(70);
    expect(STORAGE_URGENT_PCT).toBe(90);
    expect(storageLevel(70)).toBe('warn');
    expect(storageLevel(89.9)).toBe('warn');
    expect(storageLevel(90)).toBe('urgent');
    expect(storageLevel(140)).toBe('urgent');
  });

  it('treats a nonsense reading as fine rather than raising a false alarm', () => {
    expect(storageLevel(Number.NaN)).toBe('ok');
    expect(storageLevel(-5)).toBe('ok');
  });
});

describe('alertDecision — tell people when it gets worse, not every day', () => {
  it('sends when storage first crosses 70%', () => {
    expect(alertDecision('ok', 'warn')).toEqual({ send: true, remember: 'warn' });
  });

  it('sends again when it then crosses 90%', () => {
    expect(alertDecision('warn', 'urgent')).toEqual({ send: true, remember: 'urgent' });
  });

  it('stays quiet while it sits at the same level', () => {
    expect(alertDecision('warn', 'warn')).toEqual({ send: false, remember: 'warn' });
    expect(alertDecision('urgent', 'urgent')).toEqual({ send: false, remember: 'urgent' });
  });

  it('stays quiet when it improves, but remembers, so crossing again alerts again', () => {
    expect(alertDecision('urgent', 'warn')).toEqual({ send: false, remember: 'warn' });
    expect(alertDecision('warn', 'ok')).toEqual({ send: false, remember: 'ok' });
    expect(alertDecision('ok', 'warn').send).toBe(true);
  });

  it('jumping straight to urgent sends once', () => {
    expect(alertDecision('ok', 'urgent')).toEqual({ send: true, remember: 'urgent' });
  });
});

describe('storageAlertText', () => {
  const base = { pct: 72.4, usedLabel: '724 MB', quotaLabel: '1 GB' };

  it('says how full it is and what the office can do about it', () => {
    const t = storageAlertText('warn', { ...base, deletionEnabled: false });
    expect(t.subject).toMatch(/72%/);
    expect(t.body).toContain('724 MB');
    expect(t.body).toContain('1 GB');
    expect(t.body).toMatch(/Settings/);
  });

  it('is plain that renters cannot upload once it is full, when urgent', () => {
    const t = storageAlertText('urgent', { ...base, pct: 93, deletionEnabled: false });
    expect(t.subject).toMatch(/urgent|almost full/i);
    expect(t.body).toMatch(/cannot upload|can.t upload/i);
  });

  it('is honest that nothing is being deleted automatically while deleting is off', () => {
    const off = storageAlertText('warn', { ...base, deletionEnabled: false });
    const on = storageAlertText('warn', { ...base, deletionEnabled: true });
    expect(off.body).toMatch(/nothing is deleted/i);
    expect(on.body).not.toMatch(/nothing is deleted/i);
  });
});

describe('parseStorageState', () => {
  it('reads what the daily check stored', () => {
    const v = JSON.stringify({ pct: 12.5, level: 'ok', usedBytes: 100, quotaBytes: 800, at: '2026-11-02T16:00:00.000Z' });
    expect(parseStorageState(v)).toEqual({ pct: 12.5, level: 'ok', usedBytes: 100, quotaBytes: 800, at: '2026-11-02T16:00:00.000Z' });
  });

  it('returns null for anything unreadable, so a bad row never breaks a page', () => {
    expect(parseStorageState('nope')).toBeNull();
    expect(parseStorageState(JSON.stringify({ pct: 'a' }))).toBeNull();
    expect(parseStorageState(JSON.stringify({ pct: 5, level: 'catastrophic', usedBytes: 1, quotaBytes: 1, at: 'x' }))).toBeNull();
    expect(parseStorageState(null)).toBeNull();
  });
});

describe('storageSweep — nothing is deleted unless deleting is switched on', () => {
  const steps = () => ({
    purgeAbandonedDrafts: vi.fn(async () => ({ deleted: 2 })),
    reconcileOrphanBlobs: vi.fn(async () => ({ deleted: 1 })),
    purgeToTarget: vi.fn(async () => ({ deleted: 3 })),
  });

  it('runs none of the three deleting steps while it is off', async () => {
    const s = steps();
    const out = await storageSweep(false, s);
    expect(s.purgeAbandonedDrafts).not.toHaveBeenCalled();
    expect(s.reconcileOrphanBlobs).not.toHaveBeenCalled();
    expect(s.purgeToTarget).not.toHaveBeenCalled();
    expect(out.deletion).toMatch(/off/i);
  });

  it('runs all three when it is on', async () => {
    const s = steps();
    const out = await storageSweep(true, s);
    expect(s.purgeAbandonedDrafts).toHaveBeenCalledWith(7);
    expect(s.reconcileOrphanBlobs).toHaveBeenCalled();
    expect(s.purgeToTarget).toHaveBeenCalled();
    expect(out).toMatchObject({ abandonedDrafts: { deleted: 2 }, orphanBlobs: { deleted: 1 }, storage: { deleted: 3 } });
  });

  it('keeps going when one step fails, and reports it', async () => {
    const s = steps();
    s.reconcileOrphanBlobs.mockRejectedValue(new Error('boom'));
    const out = await storageSweep(true, s);
    expect(s.purgeToTarget).toHaveBeenCalled();
    expect(out.orphanBlobs).toEqual({ error: 'Error: boom' });
  });
});

describe('formatBytes', () => {
  const MB = 1024 ** 2;
  it('shows gigabytes and megabytes the way a person says them', () => {
    expect(formatBytes(1024 ** 3)).toBe('1 GB');
    expect(formatBytes(5 * 1024 ** 3)).toBe('5 GB');
    expect(formatBytes(1.5 * 1024 ** 3)).toBe('1.5 GB');
    expect(formatBytes(724 * MB)).toBe('724 MB');
    expect(formatBytes(10.04 * MB)).toBe('10 MB');
    expect(formatBytes(0.5 * MB)).toBe('0.5 MB');
  });

  it('never prints nonsense for a missing or negative size', () => {
    expect(formatBytes(0)).toBe('0 MB');
    expect(formatBytes(-5)).toBe('0 MB');
    expect(formatBytes(Number.NaN)).toBe('0 MB');
  });
});
