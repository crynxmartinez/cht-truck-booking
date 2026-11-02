import { prisma } from './db';
import { BASELINE, config } from './config';
import { applySettings } from './settings-store';
import { formatSetting, isSettingKey, settingDef, type SettingKey } from './settings-catalog';
import { SETTING_PREFIX, planChanges, settingsFromRows } from './settings-plan';

/**
 * The office's settings, in the database.
 *
 * Stored in the existing key/value `Setting` table: one row per changed
 * setting (`cfg.<key>`), plus one history row per change (`log.<ms>.<key>`).
 * A setting nobody has changed has no row, so it follows the environment or
 * built-in value — and resetting one is just deleting its row.
 */

const LOG_PREFIX = 'log.';
/** Short, so a change shows up quickly, but a page full of reads is one query, not twenty. */
const CACHE_MS = 10_000;
let loadedAt = 0;

/**
 * Bring what the office chose into effect for this request. Call it at the
 * start of anything that reads `config`. Never throws: if the database cannot
 * be read the built-in values apply, which is the behaviour before the office
 * could change anything, rather than a page that will not load.
 */
export async function loadSettings(options: { force?: boolean } = {}): Promise<void> {
  if (!options.force && Date.now() - loadedAt < CACHE_MS) return;
  try {
    const rows = await prisma.setting.findMany({ where: { key: { startsWith: SETTING_PREFIX } } });
    applySettings(settingsFromRows(rows));
    loadedAt = Date.now();
  } catch (err) {
    console.error('settings: could not read them, using the built-in values', err);
  }
}

export type SaveResult =
  | { ok: true; changed: number }
  | { ok: false; errors: string[] };

/**
 * Apply an edit: `{ key: newValue }`, or `{ key: null }` to go back to the
 * default. All or nothing, and every change leaves a history row.
 */
export async function saveSettings(input: Record<string, unknown>, by: string): Promise<SaveResult> {
  const rows = await prisma.setting.findMany({ where: { key: { startsWith: SETTING_PREFIX } } });
  const stored = settingsFromRows(rows);

  const plan = planChanges({
    input,
    stored,
    baseline: BASELINE,
    purgeTargetPct: config.blob.purgeTargetPct,
  });
  if (!plan.ok) return plan;
  if (plan.writes.length === 0) return { ok: true, changed: 0 };

  const now = Date.now();
  const operations = plan.writes.flatMap((w) => {
    const storageKey = `${SETTING_PREFIX}${w.key}`;
    const apply =
      w.to === null
        ? prisma.setting.deleteMany({ where: { key: storageKey } })
        : prisma.setting.upsert({
            where: { key: storageKey },
            create: { key: storageKey, value: String(w.to) },
            update: { value: String(w.to) },
          });
    const history = prisma.setting.create({
      data: { key: `${LOG_PREFIX}${now}.${w.key}`, value: JSON.stringify({ from: w.from, to: w.to, by }) },
    });
    return [apply, history];
  });
  await prisma.$transaction(operations);

  await loadSettings({ force: true });
  return { ok: true, changed: plan.writes.length };
}

export type SettingChangeRow = { at: Date; key: SettingKey; label: string; from: string; to: string; by: string };

/** The latest changes, newest first, in words: “Return day text: 7 AM → 8 AM”. */
export async function recentChanges(limit = 30): Promise<SettingChangeRow[]> {
  const rows = await prisma.setting.findMany({
    where: { key: { startsWith: LOG_PREFIX } },
    orderBy: { key: 'desc' },
    take: limit,
  });

  const out: SettingChangeRow[] = [];
  for (const row of rows) {
    const [, epoch, key] = row.key.split('.');
    if (!isSettingKey(key)) continue;
    try {
      const body = JSON.parse(row.value) as { from: number | boolean; to: number | boolean | null; by: string };
      out.push({
        at: new Date(Number(epoch)),
        key,
        label: settingDef(key).label,
        from: formatSetting(key, body.from),
        to: body.to === null ? 'the default' : formatSetting(key, body.to),
        by: body.by,
      });
    } catch {
      // A row nobody can read is skipped, not allowed to break the page.
    }
  }
  return out;
}
