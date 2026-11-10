import { describe, expect, it } from 'vitest';
import { inboundKey, parseInbound, pickBooking, wantsReschedule } from './inbound';

const NOW = new Date('2026-11-12T18:00:00Z');

describe('parseInbound', () => {
  it('reads the common GoHighLevel shape', () => {
    const r = parseInbound(
      { contactId: 'c1', phone: '(951) 555-0147', email: 'Sam@Example.com', message: '  Running late, see you at 10  ', messageId: 'm1', type: 'SMS' },
      NOW,
    );
    expect(r).toMatchObject({
      contactId: 'c1', phone: '+19515550147', email: 'sam@example.com', message: 'Running late, see you at 10',
      channel: 'SMS', messageId: 'm1',
    });
  });

  it('reads the nested shape', () => {
    const r = parseInbound({ contact: { id: 'c9', phone: '+19515550147', email: 'a@b.co' }, message: { body: 'hello', id: 'mm' } }, NOW);
    expect(r).toMatchObject({ contactId: 'c9', phone: '+19515550147', message: 'hello', messageId: 'mm' });
  });

  it.each([['body'], ['messageBody'], ['text']])('reads the text from "%s"', (field) => {
    expect(parseInbound({ contactId: 'c', [field]: 'hi there' }, NOW)?.message).toBe('hi there');
  });

  it('knows an email from a text', () => {
    expect(parseInbound({ message: 'x', type: 'Email', subject: 'Re: pickup' }, NOW)).toMatchObject({ channel: 'EMAIL', subject: 'Re: pickup' });
    expect(parseInbound({ message: 'x', messageType: 'TYPE_EMAIL' }, NOW)?.channel).toBe('EMAIL');
    expect(parseInbound({ message: 'x' }, NOW)?.channel).toBe('SMS');
  });

  it.each([null, undefined, 'text', 42, [], {}, { contactId: 'c' }, { message: '   ' }])('stores nothing for %j', (v) => {
    expect(parseInbound(v, NOW)).toBeNull();
  });

  it('ignores a message that WE sent', () => {
    expect(parseInbound({ message: 'Your pickup is ready', direction: 'outbound' }, NOW)).toBeNull();
    expect(parseInbound({ message: { body: 'x', direction: 'Outbound' } }, NOW)).toBeNull();
    expect(parseInbound({ message: 'hi', direction: 'inbound' }, NOW)).not.toBeNull();
  });

  it('caps a very long reply', () => {
    expect(parseInbound({ message: 'x'.repeat(20000) }, NOW)?.message.length).toBe(5000);
  });

  it('uses the time in the payload, but not a time in the future or nonsense', () => {
    expect(parseInbound({ message: 'x', dateAdded: '2026-11-12T17:00:00Z' }, NOW)?.at.toISOString()).toBe('2026-11-12T17:00:00.000Z');
    expect(parseInbound({ message: 'x', dateAdded: '2030-01-01T00:00:00Z' }, NOW)?.at).toEqual(NOW);
    expect(parseInbound({ message: 'x', dateAdded: 'not a date' }, NOW)?.at).toEqual(NOW);
    expect(parseInbound({ message: 'x' }, NOW)?.at).toEqual(NOW);
  });

  it('leaves the phone blank, not wrong, when it cannot be read', () => {
    expect(parseInbound({ message: 'x', phone: '12' }, NOW)?.phone).toBe('');
  });
});

describe('inboundKey', () => {
  it('is the message id when there is one, cleaned', () => {
    expect(inboundKey(parseInbound({ message: 'x', messageId: 'abc/../123' }, NOW)!)).toBe('in:abc123');
  });

  it('is the same for the same reply sent twice, and different for different replies', () => {
    const a = parseInbound({ contactId: 'c1', message: 'ok' }, NOW)!;
    const again = parseInbound({ contactId: 'c1', message: 'ok' }, new Date(NOW.getTime() + 20_000))!; // a retry seconds later
    const other = parseInbound({ contactId: 'c1', message: 'no' }, NOW)!;
    const other2 = parseInbound({ contactId: 'c2', message: 'ok' }, NOW)!;
    expect(inboundKey(again)).toBe(inboundKey(a));
    expect(inboundKey(other)).not.toBe(inboundKey(a));
    expect(inboundKey(other2)).not.toBe(inboundKey(a));
  });

  it('does not mistake the contact id for the message id: two replies from one contact are two replies', () => {
    // a workflow payload with a bare top-level "id" that is the contact's own
    const first = parseInbound({ id: 'C1', contact_id: 'C1', message: 'first', dateAdded: '2026-11-12T17:00:00Z' }, NOW)!;
    const second = parseInbound({ id: 'C1', contact_id: 'C1', message: 'second', dateAdded: '2026-11-12T17:01:00Z' }, NOW)!;
    expect(first.messageId).toBeNull();
    expect(inboundKey(first)).not.toBe(inboundKey(second));
    const sameText = parseInbound({ id: 'C1', contact_id: 'C1', message: 'Yes', dateAdded: '2026-11-12T17:00:05Z' }, NOW)!;
    const sameTextLater = parseInbound({ id: 'C1', contact_id: 'C1', message: 'Yes', dateAdded: '2026-11-12T17:00:40Z' }, NOW)!;
    expect(inboundKey(sameText)).not.toBe(inboundKey(sameTextLater)); // two quick "Yes" replies are two replies
  });

  it('an id with nothing usable in it falls back to the hash, never the shared key "in:"', () => {
    const a = parseInbound({ contactId: 'c1', message: 'one', messageId: '###', dateAdded: '2026-11-12T17:00:00Z' }, NOW)!;
    const b = parseInbound({ contactId: 'c1', message: 'two', messageId: '###', dateAdded: '2026-11-12T17:00:01Z' }, NOW)!;
    expect(inboundKey(a)).toMatch(/^in:h:/);
    expect(inboundKey(a)).not.toBe(inboundKey(b));
  });

  it('a retry carries the same time in the payload, so it lands on the same key even across a minute boundary', () => {
    const body = { contactId: 'c1', message: 'ok', dateAdded: '2026-11-12T17:59:58Z' };
    const a = parseInbound(body, new Date('2026-11-12T17:59:59Z'))!;
    const retry = parseInbound(body, new Date('2026-11-12T18:00:30Z'))!;
    expect(inboundKey(retry)).toBe(inboundKey(a));
  });

  it('is short and made of safe characters', () => {
    expect(inboundKey(parseInbound({ contactId: 'c1', message: 'ok' }, NOW)!)).toMatch(/^in:h:[0-9a-f]{24}$/);
  });
});

describe('pickBooking', () => {
  const b = (id: string, stage: string, day: number) => ({ id, stage, createdAt: new Date(2026, 10, day) });

  it('prefers the newest booking still in play', () => {
    expect(pickBooking([b('old', 'CONFIRMED', 1), b('new', 'IN_USE', 5), b('done', 'COMPLETED', 9)])?.id).toBe('new');
  });

  it('falls back to the newest of all when none is in play', () => {
    expect(pickBooking([b('a', 'COMPLETED', 1), b('b', 'CANCELLED', 9), b('c', 'COMPLETED', 5)])?.id).toBe('b');
  });

  it('returns null for no candidates', () => {
    expect(pickBooking([])).toBeNull();
  });

  it('when bookings share a phone or email, prefers the one that belongs to the contact who wrote', () => {
    const mine = { ...b('mine', 'CONFIRMED', 1), ghlContactId: 'C-A' };
    const partners = { ...b('partners', 'IN_USE', 9), ghlContactId: 'C-B' };
    expect(pickBooking([mine, partners], 'C-A')?.id).toBe('mine');
    expect(pickBooking([mine, partners], 'C-B')?.id).toBe('partners');
  });

  it('falls back to all candidates when no booking has that contact, or no contact was given', () => {
    const x = { ...b('x', 'CONFIRMED', 1), ghlContactId: 'C-A' };
    const y = { ...b('y', 'IN_USE', 9), ghlContactId: 'C-B' };
    expect(pickBooking([x, y], 'C-ZZ')?.id).toBe('y');
    expect(pickBooking([x, y])?.id).toBe('y');
  });
});

describe('wantsReschedule', () => {
  it('spots a request to move or cancel, as a whole word', () => {
    expect(wantsReschedule('Can we reschedule?')).toBe(true);
    expect(wantsReschedule('please CANCEL it')).toBe(true);
    expect(wantsReschedule('Running late')).toBe(false);
    expect(wantsReschedule('cancellation policy?')).toBe(false);
  });
});
