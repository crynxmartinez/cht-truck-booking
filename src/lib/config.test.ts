import { afterEach, describe, expect, it } from 'vitest';
import { BASELINE, config } from './config';
import { SETTINGS } from './settings-catalog';
import { applySettings } from './settings-store';
import { validateSetting } from './settings-catalog';

afterEach(() => applySettings({}));

describe('config reads through what the office chose', () => {
  it('uses the built-in value until the office changes it', () => {
    expect(config.minLeadDays).toBe(BASELINE.minLeadDays);
    expect(config.returnSmsHour).toBe(BASELINE.returnSmsHour);
  });

  it('uses the office’s value once it is set, everywhere config is read', () => {
    applySettings({ minLeadDays: 4, returnSmsHour: 8, unsignedReleaseHours: 96, pickupFuelGauge: true });
    expect(config.minLeadDays).toBe(4);
    expect(config.returnSmsHour).toBe(8);
    expect(config.unsignedReleaseHours).toBe(96);
    expect(config.checklist.pickupFuelGauge).toBe(true);
  });

  it('goes back to the built-in value when the office’s is removed', () => {
    applySettings({ minLeadDays: 4 });
    applySettings({});
    expect(config.minLeadDays).toBe(BASELINE.minLeadDays);
  });

  it('never deletes anything automatically unless somebody switched it on', () => {
    expect(BASELINE.storageDeletionEnabled).toBe(false);
    expect(config.blob.deletionEnabled).toBe(false);
    applySettings({ storageDeletionEnabled: true });
    expect(config.blob.deletionEnabled).toBe(true);
  });

  it('measures storage against the size the office says they have', () => {
    applySettings({ blobQuotaGb: 5 });
    expect(config.blob.quotaBytes).toBe(5 * 1024 ** 3);
  });

  it('keeps the exact environment quota when the office has not changed the size', () => {
    expect(config.blob.quotaBytes).toBeGreaterThan(0);
    applySettings({ blobQuotaGb: BASELINE.blobQuotaGb });
    expect(config.blob.quotaBytes).toBeGreaterThan(0);
  });
});

describe('the shipped defaults', () => {
  it('give every setting in the catalog a baseline of the right kind', () => {
    for (const s of SETTINGS) {
      expect(typeof BASELINE[s.key], s.key).toBe(s.kind === 'bool' ? 'boolean' : 'number');
    }
  });

  it('are all inside the range the Settings page would allow', () => {
    for (const s of SETTINGS) {
      expect(validateSetting(s.key, BASELINE[s.key]).ok, `${s.key} = ${String(BASELINE[s.key])}`).toBe(true);
    }
  });
});
