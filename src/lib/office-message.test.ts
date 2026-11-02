import { describe, expect, it } from 'vitest';
import { MAX_EMAIL_LENGTH, MAX_SMS_LENGTH, prepareOfficeMessage, type MessageHistory } from './office-message';

const booking = { firstName: 'Sample', lastName: 'Renter', email: 'sample@example.com', phone: '+15555550100', stage: 'CONFIRMED' };
const ok = { text: 'Hi, your truck is ready early.', subject: 'Your truck', sms: true, email: true };
const blockedHistory: MessageHistory[] = [
  { channel: 'SMS', status: 'FAILED', error: 'Cannot send message as DND is active for SMS.', at: new Date('2026-11-01T10:00:00Z') },
];

describe('prepareOfficeMessage — what is about to be sent, and to whom', () => {
  it('shows who it goes to on each channel, and the exact words', () => {
    const r = prepareOfficeMessage(booking, ok, []);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.preview.recipients).toEqual([
      { channel: 'SMS', address: '+15555550100' },
      { channel: 'EMAIL', address: 'sample@example.com' },
    ]);
    expect(r.preview.text).toBe(ok.text);
    expect(r.preview.subject).toBe('Your truck');
  });

  it('sends the words exactly as typed, only trimmed at the ends', () => {
    const r = prepareOfficeMessage(booking, { ...ok, text: '  Line one\n\nLine two  ' }, []);
    expect(r.ok && r.preview.text).toBe('Line one\n\nLine two');
  });

  it('can be a text only, without needing a subject', () => {
    const r = prepareOfficeMessage(booking, { text: 'Running late?', subject: '', sms: true, email: false }, []);
    expect(r.ok && r.preview.recipients.map((x) => x.channel)).toEqual(['SMS']);
  });

  it('can be an email only', () => {
    const r = prepareOfficeMessage(booking, { ...ok, sms: false }, []);
    expect(r.ok && r.preview.recipients.map((x) => x.channel)).toEqual(['EMAIL']);
  });
});

describe('prepareOfficeMessage — refusing a message that should not go', () => {
  it('needs some words', () => {
    for (const text of ['', '   ', 'x']) {
      expect(prepareOfficeMessage(booking, { ...ok, text }, []).ok, JSON.stringify(text)).toBe(false);
    }
  });

  it('needs at least one way to send it', () => {
    const r = prepareOfficeMessage(booking, { ...ok, sms: false, email: false }, []);
    expect(r.ok).toBe(false);
  });

  it('needs a subject for an email', () => {
    expect(prepareOfficeMessage(booking, { ...ok, subject: '  ' }, []).ok).toBe(false);
    expect(prepareOfficeMessage(booking, { ...ok, subject: '  ', email: false }, []).ok).toBe(true);
  });

  it('keeps a text to a sensible length, but lets an email be longer', () => {
    const long = 'a'.repeat(MAX_SMS_LENGTH + 1);
    expect(prepareOfficeMessage(booking, { ...ok, text: long, email: false }, []).ok).toBe(false);
    expect(prepareOfficeMessage(booking, { ...ok, text: long, sms: false }, []).ok).toBe(true);
    expect(prepareOfficeMessage(booking, { ...ok, text: 'a'.repeat(MAX_EMAIL_LENGTH + 1), sms: false }, []).ok).toBe(false);
  });

  it('will not text a number that is missing, but still sends the email', () => {
    const r = prepareOfficeMessage({ ...booking, phone: '' }, ok, []);
    expect(r.ok && r.preview.recipients.map((x) => x.channel)).toEqual(['EMAIL']);
    expect(r.ok && r.preview.warnings.join(' ')).toMatch(/no phone number/i);
  });
});

describe('prepareOfficeMessage — never texting past an opt-out or Do Not Disturb', () => {
  it('drops the text, says why, and still sends the email', () => {
    const r = prepareOfficeMessage(booking, ok, blockedHistory);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.preview.recipients.map((x) => x.channel)).toEqual(['EMAIL']);
    expect(r.preview.warnings.join(' ')).toMatch(/do not disturb/i);
    expect(r.preview.warnings.join(' ')).toMatch(/email/i);
  });

  it('refuses outright if a text was the only way chosen', () => {
    const r = prepareOfficeMessage(booking, { ...ok, email: false }, blockedHistory);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/call them|send it by email/i);
  });

  it('treats an opt-out the same way', () => {
    const h: MessageHistory[] = [{ channel: 'SMS', status: 'FAILED', error: 'Cannot send message as +1555 has unsubscribed', at: new Date() }];
    const r = prepareOfficeMessage(booking, { ...ok, email: false }, h);
    expect(r.ok).toBe(false);
  });

  it('judges by the most recent text, so a text that later went through is not blocked', () => {
    const h: MessageHistory[] = [
      { channel: 'SMS', status: 'FAILED', error: 'Cannot send message as DND is active for SMS.', at: new Date('2026-10-01T10:00:00Z') },
      { channel: 'SMS', status: 'SENT', error: null, at: new Date('2026-11-01T10:00:00Z') },
    ];
    const r = prepareOfficeMessage(booking, ok, h);
    expect(r.ok && r.preview.recipients.map((x) => x.channel)).toEqual(['SMS', 'EMAIL']);
  });

  it('is not put off texting by an unrelated failure', () => {
    const h: MessageHistory[] = [{ channel: 'SMS', status: 'FAILED', error: 'Request timed out', at: new Date() }];
    const r = prepareOfficeMessage(booking, ok, h);
    expect(r.ok && r.preview.recipients.map((x) => x.channel)).toEqual(['SMS', 'EMAIL']);
  });

  it('is not put off by an email failure when texting', () => {
    const h: MessageHistory[] = [{ channel: 'EMAIL', status: 'FAILED', error: 'DND is active', at: new Date() }];
    const r = prepareOfficeMessage(booking, ok, h);
    expect(r.ok && r.preview.recipients.map((x) => x.channel)).toEqual(['SMS', 'EMAIL']);
  });
});

describe('prepareOfficeMessage — a cancelled rental', () => {
  it('still allows a message, but says the rental is cancelled', () => {
    const r = prepareOfficeMessage({ ...booking, stage: 'CANCELLED' }, ok, []);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.preview.warnings.join(' ')).toMatch(/cancelled/i);
  });
});
