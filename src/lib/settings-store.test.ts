import { afterEach, describe, expect, it } from 'vitest';
import { applySettings, isOverridden, override } from './settings-store';

afterEach(() => applySettings({}));

describe('settings-store — what the office changed, held in memory for this request', () => {
  it('returns the built-in value when nothing was changed', () => {
    expect(override('minLeadDays', 1)).toBe(1);
    expect(override('storageDeletionEnabled', false)).toBe(false);
  });

  it('returns what the office set, in place of the built-in value', () => {
    applySettings({ minLeadDays: 3, storageDeletionEnabled: true });
    expect(override('minLeadDays', 1)).toBe(3);
    expect(override('storageDeletionEnabled', false)).toBe(true);
  });

  it('ignores a stored value of the wrong type rather than breaking the app', () => {
    applySettings({ minLeadDays: true as never, storageDeletionEnabled: 7 as never });
    expect(override('minLeadDays', 1)).toBe(1);
    expect(override('storageDeletionEnabled', false)).toBe(false);
  });

  it('replaces the previous settings, never merges, so a reset really resets', () => {
    applySettings({ minLeadDays: 5 });
    applySettings({ returnSmsHour: 8 });
    expect(override('minLeadDays', 1)).toBe(1);
    expect(override('returnSmsHour', 7)).toBe(8);
  });

  it('knows which settings the office has set, even when set to the default value', () => {
    applySettings({ minLeadDays: 1 });
    expect(isOverridden('minLeadDays', 1)).toBe(true);
    expect(isOverridden('returnSmsHour', 7)).toBe(false);
  });

  it('cannot be changed by editing the object you passed in afterwards', () => {
    const mine = { minLeadDays: 3 };
    applySettings(mine);
    mine.minLeadDays = 99;
    expect(override('minLeadDays', 1)).toBe(3);
  });
});
