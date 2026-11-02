/**
 * Storage: how full is it, who gets told, and whether anything is deleted.
 *
 * Pure rules, kept apart from the Blob and database code so they can be tested.
 * The daily check in the cron job is what measures and stores the reading; the
 * CRM layout shows a banner from it, and the office is emailed when it gets
 * worse.
 */

/** Where the daily check keeps its latest reading, in the Setting table. */
export const STORAGE_STATE_KEY = 'state.storage';

export const STORAGE_WARN_PCT = 70;
export const STORAGE_URGENT_PCT = 90;

export type StorageLevel = 'ok' | 'warn' | 'urgent';

const RANK: Record<StorageLevel, number> = { ok: 0, warn: 1, urgent: 2 };

export function storageLevel(pct: number): StorageLevel {
  // A reading that is not a sensible number is not a reason to alarm anyone.
  if (!Number.isFinite(pct) || pct < 0) return 'ok';
  if (pct >= STORAGE_URGENT_PCT) return 'urgent';
  if (pct >= STORAGE_WARN_PCT) return 'warn';
  return 'ok';
}

/**
 * Tell people when it gets worse, not every day it stays bad. The level that
 * was last announced is remembered either way: when storage improves and then
 * worsens again, that is news again.
 */
export function alertDecision(announced: StorageLevel, now: StorageLevel): { send: boolean; remember: StorageLevel } {
  return { send: RANK[now] > RANK[announced], remember: now };
}

export function storageAlertText(
  level: Exclude<StorageLevel, 'ok'>,
  d: { pct: number; usedLabel: string; quotaLabel: string; deletionEnabled: boolean },
): { subject: string; body: string } {
  const pct = Math.round(d.pct);
  const urgent = level === 'urgent';

  const lines = [
    `File storage is ${pct}% full: ${d.usedLabel} of ${d.quotaLabel}.`,
    '',
    urgent
      ? 'When it is completely full, renters cannot upload their licence and insurance photos, so they cannot finish booking. Please act on this soon.'
      : 'Nothing is wrong yet, but it is filling up. When it is completely full, renters cannot upload their licence and insurance photos.',
    '',
    'What you can do:',
    '- If you have more space on your Vercel plan, set the new size under Settings, Storage, so this measures against the right number.',
    d.deletionEnabled
      ? '- Automatic deleting is switched on, so the oldest photos from finished rentals are removed once storage passes the level set under Settings.'
      : '- Automatic deleting is switched off, so nothing is deleted on its own. You can turn it on under Settings, Storage, or ask your developer to clear space.',
    '- Signed contracts are never deleted.',
  ];

  return {
    subject: urgent ? `Urgent: file storage is almost full (${pct}%)` : `File storage is ${pct}% full`,
    body: lines.join('\n'),
  };
}

export type StorageState = {
  pct: number;
  level: StorageLevel;
  usedBytes: number;
  quotaBytes: number;
  at: string;
};

/** Reads the reading the daily check stored; anything unreadable is null. */
export function parseStorageState(raw: string | null | undefined): StorageState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<StorageState>;
    const levelOk = v.level === 'ok' || v.level === 'warn' || v.level === 'urgent';
    if (
      typeof v.pct !== 'number' ||
      !levelOk ||
      typeof v.usedBytes !== 'number' ||
      typeof v.quotaBytes !== 'number' ||
      typeof v.at !== 'string'
    ) {
      return null;
    }
    return { pct: v.pct, level: v.level as StorageLevel, usedBytes: v.usedBytes, quotaBytes: v.quotaBytes, at: v.at };
  } catch {
    return null;
  }
}

export type StorageSteps = {
  purgeAbandonedDrafts: (olderThanDays: number) => Promise<unknown>;
  reconcileOrphanBlobs: () => Promise<unknown>;
  purgeToTarget: () => Promise<unknown>;
};

const ABANDONED_UPLOAD_DAYS = 7;

/**
 * The three things that delete files, behind one switch. Off means none of
 * them runs: not abandoned uploads, not stray files, not the clean-up when
 * storage is nearly full. One failing step never stops the next.
 */
export async function storageSweep(deletionEnabled: boolean, steps: StorageSteps): Promise<Record<string, unknown>> {
  if (!deletionEnabled) {
    return { deletion: 'off: nothing was deleted' };
  }
  const attempt = async (run: () => Promise<unknown>) => {
    try {
      return await run();
    } catch (err) {
      return { error: String(err) };
    }
  };
  return {
    abandonedDrafts: await attempt(() => steps.purgeAbandonedDrafts(ABANDONED_UPLOAD_DAYS)),
    orphanBlobs: await attempt(() => steps.reconcileOrphanBlobs()),
    storage: await attempt(() => steps.purgeToTarget()),
  };
}

/** 1073741824 → "1 GB", 759169024 → "724 MB". No trailing ".0". */
export function formatBytes(bytes: number): string {
  const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  const trim = (n: number, digits: number) => n.toFixed(digits).replace(/\.?0+$/, '');
  if (safe >= 1024 ** 3) return `${trim(safe / 1024 ** 3, 2)} GB`;
  return `${trim(safe / 1024 ** 2, 1) || '0'} MB`;
}
