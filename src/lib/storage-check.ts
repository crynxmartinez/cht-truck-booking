import { prisma } from './db';
import { config } from './config';
import { notifyOffice } from './notify';
import { blobConfigured, measureUsage, type UsageReport } from './storage';
import {
  alertDecision,
  STORAGE_STATE_KEY,
  formatBytes,
  storageAlertText,
  storageLevel,
  type StorageLevel,
  type StorageState,
} from './storage-alert';

const ANNOUNCED_KEY = 'state.storageAlerted';

type Deps = {
  configured: () => boolean;
  measure: () => Promise<UsageReport>;
  notify: typeof notifyOffice;
  deletionEnabled: () => boolean;
};

const live: Deps = {
  configured: blobConfigured,
  measure: measureUsage,
  notify: notifyOffice,
  deletionEnabled: () => config.blob.deletionEnabled,
};

async function put(key: string, value: string) {
  await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

const asLevel = (v: string | undefined): StorageLevel => (v === 'warn' || v === 'urgent' ? v : 'ok');

/**
 * The daily storage reading. Measures what is used, stores it so the CRM can
 * show a banner without asking Blob on every page, and emails the office when
 * it gets worse (70%, then 90%) — once per level, not every day.
 *
 * An alert nobody received is not counted as given, so it is tried again the
 * next day. Never throws: a storage check failing must not stop the rest of
 * the daily sweep.
 */
export async function runStorageCheck(deps: Deps = live): Promise<Record<string, unknown>> {
  if (!deps.configured()) return { skipped: 'storage is not connected' };

  try {
    const usage = await deps.measure();
    const level = storageLevel(usage.pct);

    const announced = asLevel((await prisma.setting.findUnique({ where: { key: ANNOUNCED_KEY } }))?.value);
    const decision = alertDecision(announced, level);

    const state: StorageState = {
      pct: usage.pct,
      level,
      usedBytes: usage.totalBytes,
      quotaBytes: usage.quotaBytes,
      at: new Date().toISOString(),
    };
    await put(STORAGE_STATE_KEY, JSON.stringify(state));

    let alerted = false;
    let remember: StorageLevel = decision.remember;

    if (decision.send && level !== 'ok') {
      const text = storageAlertText(level, {
        pct: usage.pct,
        usedLabel: formatBytes(usage.totalBytes),
        quotaLabel: formatBytes(usage.quotaBytes),
        deletionEnabled: deps.deletionEnabled(),
      });
      const sent = await deps.notify(text.subject, text.body, {
        urgent: level === 'urgent',
        sms: level === 'urgent' ? `${text.subject}. Open the CRM, Settings, Storage.` : undefined,
      });
      alerted = sent.sent > 0;
      // Nobody reached: keep the old level so tomorrow's check tries again.
      if (!alerted) remember = announced;
    }

    if (remember !== announced) await put(ANNOUNCED_KEY, remember);

    return { level, pct: Math.round(usage.pct * 10) / 10, alerted };
  } catch (err) {
    console.error('storage check failed', err);
    return { error: String(err) };
  }
}
