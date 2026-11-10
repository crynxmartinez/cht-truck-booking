import { describe, expect, it } from 'vitest';
import { buildThread, countUnread, inThread, labelFor, unreadBookingIds, type ThreadRow } from './conversation';

const at = (s: string) => new Date(s);
let n = 0;
const row = (over: Partial<ThreadRow> = {}): ThreadRow => ({
  id: `r${++n}`, template: 'pickup_morning', channel: 'SMS', status: 'SENT', recipientKey: 'renter', toAddress: '+15555550100',
  subject: null, body: 'Hello', error: null, sentAt: at('2026-11-12T10:00:00Z'), createdAt: at('2026-11-12T10:00:00Z'), ...over,
});

describe('buildThread', () => {
  it('puts what we sent and what they replied in time order', () => {
    const t = buildThread([
      row({ id: 'b', template: 'inbound_reply', recipientKey: 'in:m1', toAddress: null, body: 'Running late', sentAt: at('2026-11-12T11:00:00Z') }),
      row({ id: 'a', template: 'pickup_morning', body: 'Your truck is ready', sentAt: at('2026-11-12T10:00:00Z') }),
      row({ id: 'c', template: 'office_message', recipientKey: 'office-x', body: 'No problem', sentAt: at('2026-11-12T11:05:00Z') }),
    ]);
    expect(t.map((i) => [i.dir, i.from, i.text])).toEqual([
      ['out', 'auto', 'Your truck is ready'],
      ['in', 'renter', 'Running late'],
      ['out', 'office', 'No problem'],
    ]);
  });

  it('leaves out staff alerts, which share the table', () => {
    const t = buildThread([row({ recipientKey: 'cmstaff123', body: 'Staff alert' }), row({ body: 'To the renter' })]);
    expect(t.map((i) => i.text)).toEqual(['To the renter']);
    expect(inThread({ recipientKey: 'cmstaff123' })).toBe(false);
  });

  it('leaves out messages that never went out, but shows ones that failed', () => {
    const t = buildThread([
      row({ status: 'SKIPPED', body: 'skipped' }),
      row({ status: 'QUEUED', body: 'queued' }),
      row({ status: 'FAILED', body: 'blocked one', error: 'DND is active' }),
    ]);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ failed: true, error: 'DND is active' });
  });

  it('reads the button markup in our emails as plain words', () => {
    const t = buildThread([row({ channel: 'EMAIL', body: 'Please [[Sign here|https://x.example/sign/abc]] today' })]);
    expect(t[0].text).not.toContain('[[');
    expect(t[0].text).toContain('Sign here');
  });

  it('keeps a reply exactly as written', () => {
    const t = buildThread([row({ template: 'inbound_reply', recipientKey: 'in:m', toAddress: null, body: 'see [[this]] and\n\nmore' })]);
    expect(t[0].text).toBe('see [[this]] and\n\nmore');
  });

  it('says so when the text of a message was not saved', () => {
    expect(buildThread([row({ body: null })])[0].text).toMatch(/not saved/);
    expect(buildThread([row({ body: '' })])[0].text).toMatch(/not saved/);
  });

  it('uses the time it went out, and falls back to when it was made', () => {
    const t = buildThread([row({ sentAt: null, createdAt: at('2026-11-12T09:00:00Z') })]);
    expect(t[0].at).toBe('2026-11-12T09:00:00.000Z');
  });

  it('includes replies an older version saved as activity entries', () => {
    const t = buildThread([row({ body: 'Out' })], [{ id: 'e1', detail: 'Old reply', createdAt: at('2026-11-12T12:00:00Z') }, { id: 'e2', detail: null, createdAt: at('2026-11-12T12:00:00Z') }]);
    expect(t.map((i) => i.text)).toEqual(['Out', 'Old reply']);
    expect(t[1]).toMatchObject({ dir: 'in', id: 'ev-e1' });
  });

  it('gives each kind of message a plain name', () => {
    expect(labelFor('pickup_morning')).toBe('Pickup and lockbox code');
    expect(labelFor('something_new_later')).toBe('Something new later');
  });
});

describe('unread', () => {
  const reply = (key: string, arrived: string, over: Partial<ThreadRow> = {}) =>
    row({ template: 'inbound_reply', recipientKey: key, toAddress: null, createdAt: at(arrived), sentAt: at(arrived), ...over });
  const rows = [reply('in:1', '2026-11-12T10:00:00Z'), reply('in:2', '2026-11-12T12:00:00Z'), row({ createdAt: at('2026-11-12T13:00:00Z') })];

  it('counts only replies that arrived after the last time it was read', () => {
    expect(countUnread(rows, null)).toBe(2);
    expect(countUnread(rows, at('2026-11-12T11:00:00Z'))).toBe(1);
    expect(countUnread(rows, at('2026-11-12T14:00:00Z'))).toBe(0);
  });

  it('judges a late-delivered reply by when it reached us, not the time in it', () => {
    const late = reply('in:3', '2026-11-12T15:00:00Z', { sentAt: at('2026-11-12T09:00:00Z') });
    expect(countUnread([late], at('2026-11-12T12:00:00Z'))).toBe(1);
  });

  it('does not count messages we sent, or staff alerts', () => {
    expect(countUnread([row({ createdAt: at('2026-11-12T13:00:00Z') }), row({ recipientKey: 'cmstaff1', createdAt: at('2026-11-12T13:00:00Z') })], null)).toBe(0);
  });

  it('finds which bookings have a reply nobody has read', () => {
    const replies = new Map([['a', at('2026-11-12T12:00:00Z')], ['b', at('2026-11-12T12:00:00Z')], ['c', at('2026-11-12T12:00:00Z')]]);
    const read = new Map([['b', at('2026-11-12T13:00:00Z')], ['c', at('2026-11-12T11:00:00Z')]]);
    expect([...unreadBookingIds(replies, read)].sort()).toEqual(['a', 'c']);
  });
});
