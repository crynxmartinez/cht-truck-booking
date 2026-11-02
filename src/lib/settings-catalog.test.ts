import { describe, expect, it } from 'vitest';
import {
  SETTINGS,
  checkCombination,
  formatSetting,
  settingDef,
  validateSetting,
  type SettingKey,
} from './settings-catalog';

const KEYS = SETTINGS.map((s) => s.key);

describe('the catalog', () => {
  it('has no duplicate keys', () => {
    expect(new Set(KEYS).size).toBe(KEYS.length);
  });

  it('gives every setting a plain-English label and help text', () => {
    for (const s of SETTINGS) {
      expect(s.label.length).toBeGreaterThan(3);
      expect(s.help.length).toBeGreaterThan(15);
    }
  });

  it('gives every number setting sensible bounds', () => {
    for (const s of SETTINGS.filter((x) => x.kind === 'int')) {
      expect(s.min).toBeDefined();
      expect(s.max).toBeDefined();
      expect(s.min!).toBeLessThan(s.max!);
    }
  });

  it('looks a setting up by key and refuses an unknown one', () => {
    expect(settingDef('minLeadDays').label).toMatch(/notice|lead/i);
    expect(() => settingDef('nope' as SettingKey)).toThrow();
  });
});

describe('validateSetting', () => {
  it('accepts a whole number inside the range', () => {
    expect(validateSetting('minLeadDays', '2')).toEqual({ ok: true, value: 2 });
    expect(validateSetting('minLeadDays', 2)).toEqual({ ok: true, value: 2 });
  });

  it('accepts both ends of the range', () => {
    const d = settingDef('pickupSmsHour');
    expect(validateSetting('pickupSmsHour', d.min!)).toMatchObject({ ok: true });
    expect(validateSetting('pickupSmsHour', d.max!)).toMatchObject({ ok: true });
  });

  it('refuses a number just outside the range and says what is allowed', () => {
    const d = settingDef('pickupSmsHour');
    const low = validateSetting('pickupSmsHour', d.min! - 1);
    const high = validateSetting('pickupSmsHour', d.max! + 1);
    expect(low.ok).toBe(false);
    expect(high.ok).toBe(false);
    if (!low.ok) expect(low.error).toContain(String(d.min));
  });

  it.each(['', '  ', 'abc', '1.5', 'NaN', 'Infinity', null, undefined, {}, []])(
    'refuses %j as a number',
    (raw) => {
      expect(validateSetting('minLeadDays', raw as never).ok).toBe(false);
    },
  );

  it('reads a switch from true/false and from on/off', () => {
    expect(validateSetting('storageDeletionEnabled', 'true')).toEqual({ ok: true, value: true });
    expect(validateSetting('storageDeletionEnabled', false)).toEqual({ ok: true, value: false });
    expect(validateSetting('storageDeletionEnabled', 'off')).toEqual({ ok: true, value: false });
  });

  it('refuses anything else for a switch', () => {
    expect(validateSetting('storageDeletionEnabled', 'maybe').ok).toBe(false);
    expect(validateSetting('storageDeletionEnabled', 3).ok).toBe(false);
  });

  it('refuses an unknown setting instead of storing it', () => {
    expect(validateSetting('whatever' as SettingKey, 1).ok).toBe(false);
  });
});

describe('checkCombination — settings that must agree with each other', () => {
  const ok = {
    pickupSmsHour: 6,
    pickupReminderHour: 10,
    noPickupCheckHour: 14,
    pickupLastHour: 19,
  };

  it('accepts the shipped defaults', () => {
    expect(checkCombination(ok)).toBeNull();
  });

  it('refuses a reminder that is not after the first text', () => {
    expect(checkCombination({ ...ok, pickupReminderHour: 6 })).toMatch(/after/i);
    expect(checkCombination({ ...ok, pickupSmsHour: 11 })).toMatch(/after/i);
  });

  it('refuses a final text that is not after the reminder', () => {
    expect(checkCombination({ ...ok, noPickupCheckHour: 10 })).toMatch(/after/i);
  });

  it('refuses a cut-off that is not after the final text', () => {
    expect(checkCombination({ ...ok, pickupLastHour: 14 })).toMatch(/after/i);
  });

  it('never lets the truck be released before the renter has had their one reminder', () => {
    // The reminder goes out at the first daily check after 24 hours, so a
    // release window of a day or less could cancel someone who was never nudged.
    expect(validateSetting('unsignedReleaseHours', 24).ok).toBe(false);
    expect(validateSetting('unsignedReleaseHours', 47).ok).toBe(false);
    expect(validateSetting('unsignedReleaseHours', 48).ok).toBe(true);
    expect(checkCombination({ ...ok, unsignedReleaseHours: 72 })).toBeNull();
  });

  it('refuses a clean-up target that is not below the trigger', () => {
    expect(checkCombination({ ...ok, purgeStartPct: 80, purgeTargetPct: 80 })).toMatch(/below|under/i);
    expect(checkCombination({ ...ok, purgeStartPct: 80, purgeTargetPct: 70 })).toBeNull();
  });

  it('ignores settings it was not given', () => {
    expect(checkCombination({})).toBeNull();
  });
});

describe('formatSetting — what the office reads', () => {
  it('shows an hour as AM or PM, never as 07', () => {
    expect(formatSetting('returnSmsHour', 7)).toBe('7 AM');
    expect(formatSetting('pickupLastHour', 19)).toBe('7 PM');
    expect(formatSetting('pickupSmsHour', 12)).toBe('12 PM');
  });

  it('pluralises days and hours', () => {
    expect(formatSetting('minLeadDays', 1)).toBe('1 day');
    expect(formatSetting('minLeadDays', 3)).toBe('3 days');
    expect(formatSetting('unsignedReleaseHours', 72)).toBe('72 hours (3 days)');
  });

  it('shows a switch as On or Off', () => {
    expect(formatSetting('storageDeletionEnabled', true)).toBe('On');
    expect(formatSetting('storageDeletionEnabled', false)).toBe('Off');
  });
});
