import { describe, expect, it } from 'vitest';
import { googleCalendarLink } from './calendar-link';

describe('googleCalendarLink', () => {
  it('encodes the calendar id the way Google expects, without padding', () => {
    const id = 'abc123@group.calendar.google.com';
    const link = googleCalendarLink(id)!;
    expect(link).toMatch(/^https:\/\/calendar\.google\.com\/calendar\/u\/0\?cid=/);
    const cid = decodeURIComponent(link.split('cid=')[1]);
    expect(cid).not.toMatch(/=/);
    expect(Buffer.from(cid, 'base64').toString('utf8')).toBe(id);
  });

  it('survives characters that would break a query string', () => {
    // Chosen so the base64 contains + and / when encoded.
    const id = '???>>>@group.calendar.google.com';
    const link = googleCalendarLink(id)!;
    expect(link.split('cid=')[1]).not.toMatch(/[+/]/);
    const cid = decodeURIComponent(link.split('cid=')[1]);
    expect(Buffer.from(cid, 'base64').toString('utf8')).toBe(id);
  });

  it('returns null when there is no calendar to link to', () => {
    expect(googleCalendarLink('')).toBeNull();
    expect(googleCalendarLink('   ')).toBeNull();
  });
});
