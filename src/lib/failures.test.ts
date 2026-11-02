import { describe, expect, it } from 'vitest';
import { explainFailure, isUrgentFailure } from './failures';

describe('explainFailure — what a failed message means and what to do', () => {
  it('explains a Do Not Disturb block and never suggests overriding it', () => {
    const f = explainFailure('Cannot send message as DND is active for SMS.', 'SMS');
    expect(f.kind).toBe('dnd');
    expect(f.reason).toMatch(/do not disturb/i);
    expect(f.action).toMatch(/call|email/i);
    expect(f.action).not.toMatch(/turn (it )?off|bypass|override|disable/i);
  });

  it('explains a renter who has opted out', () => {
    const f = explainFailure('Cannot send message as +19515550123 has unsubscribed', 'SMS');
    expect(f.kind).toBe('unsubscribed');
    expect(f.reason).toMatch(/opted out|stop/i);
    expect(f.action).toMatch(/do not text/i);
  });

  it('does not repeat the renter’s phone number into the explanation', () => {
    const f = explainFailure('Cannot send message as +19515550123 has unsubscribed', 'SMS');
    expect(`${f.reason}${f.action}`).not.toContain('9515550123');
  });

  it('explains a bad or missing phone number', () => {
    expect(explainFailure('Invalid phone number', 'SMS').kind).toBe('bad_number');
    expect(explainFailure('phone is required', 'SMS').kind).toBe('bad_number');
  });

  it('falls back to the raw reason and a safe next step for anything else', () => {
    const f = explainFailure('Request timed out', 'EMAIL');
    expect(f.kind).toBe('other');
    expect(f.reason).toContain('Request timed out');
    expect(f.action).toMatch(/resend|developer/i);
  });

  it('copes with a missing error', () => {
    expect(explainFailure(null, 'SMS').kind).toBe('other');
    expect(explainFailure('', 'EMAIL').reason.length).toBeGreaterThan(5);
  });
});

describe('isUrgentFailure — a blocked lockbox code is not like other failures', () => {
  const today = '2026-11-02';
  const base = { channel: 'SMS', template: 'pickup_morning', stage: 'CONFIRMED', pickupIso: today, todayIso: today };

  it('is urgent when the pickup-day code text failed and the renter has not collected', () => {
    expect(isUrgentFailure(base)).toBe(true);
    expect(isUrgentFailure({ ...base, template: 'pickup_reminder' })).toBe(true);
    expect(isUrgentFailure({ ...base, stage: 'PICKUP_DAY' })).toBe(true);
  });

  it('is urgent for a pickup that is still ahead', () => {
    expect(isUrgentFailure({ ...base, pickupIso: '2026-11-05' })).toBe(true);
  });

  it('is not urgent once the truck is out, back, closed or cancelled', () => {
    for (const stage of ['IN_USE', 'RETURNED', 'COMPLETED', 'CANCELLED']) {
      expect(isUrgentFailure({ ...base, stage }), stage).toBe(false);
    }
  });

  it('is not urgent when the pickup date has already passed', () => {
    expect(isUrgentFailure({ ...base, pickupIso: '2026-10-30' })).toBe(false);
  });

  it('is not urgent for other messages, or for an email', () => {
    expect(isUrgentFailure({ ...base, template: 'thank_you' })).toBe(false);
    expect(isUrgentFailure({ ...base, channel: 'EMAIL' })).toBe(false);
  });
});
