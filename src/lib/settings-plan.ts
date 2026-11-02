import {
  checkCombination,
  isSettingKey,
  settingDef,
  validateSetting,
  type SettingKey,
} from './settings-catalog';

/**
 * Deciding whether an edit to the settings is allowed, and what it would do.
 * Pure: nothing here reads or writes the database, so the rules can be tested
 * without one. settings.ts does the reading and writing around it.
 */

type Value = number | boolean;
type Values = Partial<Record<SettingKey, Value>>;

/** Stored rows live in the `Setting` table under this prefix. */
export const SETTING_PREFIX = 'cfg.';

/** Turns stored rows into settings, ignoring anything that is not a valid, known setting. */
export function settingsFromRows(rows: ReadonlyArray<{ key: string; value: string }>): Values {
  const out: Values = {};
  for (const row of rows) {
    if (!row.key.startsWith(SETTING_PREFIX)) continue;
    const key = row.key.slice(SETTING_PREFIX.length);
    if (!isSettingKey(key)) continue;
    const parsed = validateSetting(key, row.value);
    // A stored value that is no longer allowed (a range was tightened) is
    // ignored rather than trusted: the built-in value applies instead.
    if (parsed.ok) out[key] = parsed.value;
  }
  return out;
}

export type PlannedWrite = { key: SettingKey; from: Value; to: Value | null };

export type Plan = { ok: true; writes: PlannedWrite[] } | { ok: false; errors: string[] };

/**
 * `input` maps a setting key to the new value, or to null meaning "put it back
 * to the default". Anything wrong refuses the whole edit, so a half-applied
 * change can never leave settings that disagree with each other.
 */
export function planChanges(opts: {
  input: Record<string, unknown>;
  stored: Values;
  baseline: Record<SettingKey, Value>;
  /** Fixed, not editable: where deleting stops once it has started. */
  purgeTargetPct: number;
}): Plan {
  const { input, stored, baseline } = opts;
  const errors: string[] = [];
  const next: Values = { ...stored };
  const writes: PlannedWrite[] = [];

  for (const [key, raw] of Object.entries(input)) {
    if (!isSettingKey(key)) {
      errors.push(`“${key}” is not a setting you can change.`);
      continue;
    }

    const before: Value = stored[key] ?? baseline[key];

    if (raw === null) {
      if (key in stored) {
        delete next[key];
        writes.push({ key, from: before, to: null });
      }
      continue;
    }

    const checked = validateSetting(key, raw);
    if (!checked.ok) {
      errors.push(checked.error);
      continue;
    }
    if (checked.value === before) continue;

    next[key] = checked.value;
    writes.push({ key, from: before, to: checked.value });
  }

  if (errors.length) return { ok: false, errors };

  // The rules between settings are judged on the result, with the defaults
  // filled in, so changing two together is judged together.
  const effective: Values & { purgeTargetPct: number } = { ...baseline, ...next, purgeTargetPct: opts.purgeTargetPct };
  const clash = checkCombination(effective);
  if (clash) return { ok: false, errors: [clash] };

  return { ok: true, writes };
}

/** Which setting a change belongs to, for the history list. */
export const labelOf = (key: SettingKey): string => settingDef(key).label;
