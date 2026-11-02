import { describe, expect, it } from 'vitest';
import { planChanges, settingsFromRows } from './settings-plan';
import { SETTINGS, type SettingKey } from './settings-catalog';

const baseline: Record<SettingKey, number | boolean> = {
  minLeadDays: 1,
  maxMonthsAhead: 3,
  pickupSmsHour: 6,
  pickupReminderHour: 10,
  noPickupCheckHour: 14,
  pickupLastHour: 19,
  returnSmsHour: 7,
  dailySweepHour: 9,
  unsignedReleaseHours: 72,
  completedHideDays: 14,
  storageDeletionEnabled: false,
  blobQuotaGb: 1,
  purgeStartPct: 80,
  idDocsDays: 30,
  checklistPhotoDays: 90,
  pickupFuelGauge: false,
  exteriorPhotos: false,
};
const PURGE_TARGET = 70;

const plan = (input: Record<string, unknown>, stored: Partial<Record<SettingKey, number | boolean>> = {}) =>
  planChanges({ input, stored, baseline, purgeTargetPct: PURGE_TARGET });

describe('settingsFromRows — reading what is stored', () => {
  it('reads known settings and strips the prefix', () => {
    expect(settingsFromRows([{ key: 'cfg.minLeadDays', value: '3' }, { key: 'cfg.pickupFuelGauge', value: 'true' }])).toEqual({
      minLeadDays: 3,
      pickupFuelGauge: true,
    });
  });

  it('ignores rows that are not settings, unknown settings, and values that are no longer valid', () => {
    expect(
      settingsFromRows([
        { key: 'ghl.staff.contactId', value: 'abc' },
        { key: 'cfg.nonsense', value: '1' },
        { key: 'cfg.minLeadDays', value: '9999' },
        { key: 'cfg.returnSmsHour', value: 'soon' },
        { key: 'log.1.minLeadDays', value: '{}' },
      ]),
    ).toEqual({});
  });
});

describe('planChanges — deciding whether an edit is allowed, and what it would do', () => {
  it('plans a valid change and records what it was before', () => {
    const r = plan({ minLeadDays: '3' });
    expect(r).toEqual({ ok: true, writes: [{ key: 'minLeadDays', from: 1, to: 3 }] });
  });

  it('plans nothing for a value that is already in effect', () => {
    expect(plan({ minLeadDays: '1' })).toEqual({ ok: true, writes: [] });
    expect(plan({ minLeadDays: '5' }, { minLeadDays: 5 })).toEqual({ ok: true, writes: [] });
  });

  it('measures “before” from what is in effect, not the built-in value', () => {
    const r = plan({ minLeadDays: '2' }, { minLeadDays: 5 });
    expect(r).toEqual({ ok: true, writes: [{ key: 'minLeadDays', from: 5, to: 2 }] });
  });

  it('refuses the whole edit if any one value is out of range, writing nothing', () => {
    const r = plan({ minLeadDays: '3', pickupSmsHour: '99' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/Pickup day: first text/);
  });

  it('refuses a setting it does not know', () => {
    const r = plan({ launchTheRockets: '1' });
    expect(r.ok).toBe(false);
  });

  it('refuses settings that contradict each other, judged on the result, not on each alone', () => {
    // The reminder alone is fine; with the first text moved to 11 it is not.
    const r = plan({ pickupSmsHour: '11' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/after/i);
  });

  it('accepts two settings that only make sense together', () => {
    const r = plan({ pickupSmsHour: '11', pickupReminderHour: '12' });
    expect(r.ok).toBe(true);
  });

  it('judges the deleting level against the fixed stop level', () => {
    // Starting at 75 is fine against a 70 stop level; the catalog minimum is 75 for that reason.
    expect(plan({ purgeStartPct: '75' }).ok).toBe(true);
  });

  it('plans a reset by asking for the default, and only if something was stored', () => {
    expect(plan({ minLeadDays: null }, { minLeadDays: 4 })).toEqual({
      ok: true,
      writes: [{ key: 'minLeadDays', from: 4, to: null }],
    });
    expect(plan({ minLeadDays: null }, {})).toEqual({ ok: true, writes: [] });
  });

  it('can change a switch', () => {
    expect(plan({ storageDeletionEnabled: 'true' })).toEqual({
      ok: true,
      writes: [{ key: 'storageDeletionEnabled', from: false, to: true }],
    });
  });

  it('reports every problem at once, so the office fixes them in one go', () => {
    const r = plan({ minLeadDays: '-3', maxMonthsAhead: 'lots' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveLength(2);
  });
});

describe('planChanges — properties', () => {
  it('never plans a value outside the allowed range, for any whole number', () => {
    for (const s of SETTINGS.filter((x) => x.kind === 'int')) {
      for (const n of [s.min! - 1000, s.min! - 1, s.max! + 1, s.max! + 1000]) {
        const r = plan({ [s.key]: String(n) });
        expect(r.ok, `${s.key}=${n}`).toBe(false);
      }
    }
  });

  it('accepts exactly the range ends where nothing else disagrees', () => {
    for (const s of SETTINGS.filter((x) => x.kind === 'int' && !x.key.includes('Hour') && x.key !== 'purgeStartPct')) {
      expect(plan({ [s.key]: String(s.min) }).ok, `${s.key} min`).toBe(true);
      expect(plan({ [s.key]: String(s.max) }).ok, `${s.key} max`).toBe(true);
    }
  });
});
