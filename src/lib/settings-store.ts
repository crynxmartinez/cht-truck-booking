import type { SettingKey } from './settings-catalog';

/**
 * The settings the office has changed, held in memory.
 *
 * config.ts reads through here so that every place that already says
 * `config.returnSmsHour` keeps working unchanged, but now gets what the office
 * chose instead of only what the environment says. Loading them from the
 * database is settings.ts's job; this file has no database in it so config.ts
 * can depend on it without a cycle.
 *
 * Replaced wholesale on every load, never merged, so resetting a setting back
 * to its default really does put it back.
 */
type Values = Readonly<Partial<Record<SettingKey, number | boolean>>>;

let snapshot: Values = Object.freeze({});

export function applySettings(next: Values): void {
  snapshot = Object.freeze({ ...next });
}

/** The office's value if they set one of the right kind, otherwise the fallback. */
export function override<T extends number | boolean>(key: SettingKey, fallback: T): T {
  const value = snapshot[key];
  return (typeof value === typeof fallback ? value : fallback) as T;
}

/** For the Settings page: has the office set this one, even to the same value as the default? */
export function isOverridden(key: SettingKey, fallback: number | boolean): boolean {
  return typeof snapshot[key] === typeof fallback;
}
