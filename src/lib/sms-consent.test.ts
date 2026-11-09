import { describe, expect, it } from 'vitest';
import { blockedKind, checkConsent, consentLogLine, CONSENT_WAYS, type SmsHistory } from './sms-consent';

const PHONE = '+15555550100';
const at = (iso: string) => new Date(iso);
const sms = (over: Partial<SmsHistory>): SmsHistory => ({
  channel: 'SMS',
  to: PHONE,
  status: 'SENT',
  error: null,
  at: at('2026-11-01T10:00:00Z'),
  ...over,
});

describe('blockedKind', () => {
  it('is null when nothing has been sent', () => {
    expect(blockedKind([], PHONE)).toBeNull();
  });

  it('sees Do Not Disturb on the latest text to that number', () => {
    const h = [sms({ status: 'FAILED', error: 'Cannot send message as DND is active for SMS.' })];
    expect(blockedKind(h, PHONE)).toBe('dnd');
  });

  it('sees a STOP opt-out', () => {
    const h = [sms({ status: 'FAILED', error: 'Contact has unsubscribed from SMS' })];
    expect(blockedKind(h, PHONE)).toBe('unsubscribed');
  });

  it('is cleared by a later text that went through', () => {
    const h = [
      sms({ status: 'FAILED', error: 'DND is active', at: at('2026-11-01T10:00:00Z') }),
      sms({ status: 'SENT', at: at('2026-11-02T10:00:00Z') }),
    ];
    expect(blockedKind(h, PHONE)).toBeNull();
  });

  it('judges each number on its own', () => {
    const h = [sms({ status: 'FAILED', error: 'DND is active', to: '+15555550999' })];
    expect(blockedKind(h, PHONE)).toBeNull();
  });

  it('ignores emails and failures that are not about consent', () => {
    expect(blockedKind([sms({ channel: 'EMAIL', status: 'FAILED', error: 'DND is active' })], PHONE)).toBeNull();
    expect(blockedKind([sms({ status: 'FAILED', error: 'Network timeout' })], PHONE)).toBeNull();
  });
});

describe('checkConsent', () => {
  it('accepts a known way with a real note', () => {
    const c = checkConsent('phone', '  Spoke to Diana on the phone, Nov 9 2pm ');
    expect(c).toMatchObject({ ok: true, way: 'phone', note: 'Spoke to Diana on the phone, Nov 9 2pm' });
  });

  it('accepts every listed way', () => {
    for (const w of CONSENT_WAYS) expect(checkConsent(w.key, 'Asked Diana, Nov 9').ok).toBe(true);
  });

  it.each([undefined, null, '', 'whatever', 42, 'Phone'])('refuses an unknown way: %s', (way) => {
    expect(checkConsent(way, 'Asked Diana on Nov 9')).toMatchObject({ ok: false });
  });

  it.each([undefined, null, 42, '', '   ', 'ok', 'yes yes'])('refuses a missing or token note: %s', (note) => {
    expect(checkConsent('phone', note)).toMatchObject({ ok: false });
  });

  it('refuses a very long note', () => {
    expect(checkConsent('email', 'x'.repeat(301))).toMatchObject({ ok: false });
  });
});

describe('the misread-STOP way', () => {
  it('is offered, and recorded in the log', () => {
    const c = checkConsent('misread', 'Called Dana Nov 9, said stop meant stop by at 3');
    if (!c.ok) throw new Error('expected ok');
    expect(consentLogLine(c)).toContain("didn't mean to opt out");
  });
});

describe('consentLogLine', () => {
  it('records how and what was said', () => {
    const c = checkConsent('in_person', 'At the yard, Nov 9, told Dana');
    if (!c.ok) throw new Error('expected ok');
    const line = consentLogLine(c);
    expect(line).toContain('at the renter');
    expect(line).toContain('in person');
    expect(line).toContain('At the yard, Nov 9, told Dana');
  });
});
