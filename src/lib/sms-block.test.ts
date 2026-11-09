import { describe, expect, it } from 'vitest';
import { allowSmsBody, otherChannelsChanged, parseSmsBlock } from './sms-block';

describe('parseSmsBlock', () => {
  it('reads the contact wrapped or at the top level', () => {
    const settings = { SMS: { status: 'active' } };
    expect(parseSmsBlock({ contact: { dndSettings: settings } }).blocked).toBe(true);
    expect(parseSmsBlock({ dndSettings: settings }).blocked).toBe(true);
  });

  it.each(['active', 'Active', 'ACTIVE', 'permanent'])('treats %s as blocked', (status) => {
    expect(parseSmsBlock({ contact: { dndSettings: { SMS: { status } } } }).blocked).toBe(true);
  });

  it('treats inactive as not blocked', () => {
    expect(parseSmsBlock({ contact: { dndSettings: { SMS: { status: 'inactive' } } } })).toMatchObject({
      blocked: false,
      status: 'inactive',
    });
  });

  it('treats nothing set at all as not blocked', () => {
    expect(parseSmsBlock({ contact: {} }).blocked).toBe(false);
    expect(parseSmsBlock({ contact: { dndSettings: { Email: { status: 'active' } } } }).blocked).toBe(false);
  });

  it('treats a status it does not recognise, or an empty one, as blocked', () => {
    expect(parseSmsBlock({ contact: { dndSettings: { SMS: { status: '' } } } }).blocked).toBe(true);
    expect(parseSmsBlock({ contact: { dndSettings: { SMS: { status: 'paused' } } } }).blocked).toBe(true);
  });

  it('treats the whole contact on Do Not Disturb as blocked even when texts say inactive', () => {
    const r = parseSmsBlock({ contact: { dnd: true, dndSettings: { SMS: { status: 'inactive' } } } });
    expect(r).toMatchObject({ blocked: true, status: 'global' });
  });

  it.each([null, undefined, 'x', 42, [], {}])('does not crash on %j and keeps going', (v) => {
    expect(() => parseSmsBlock(v)).not.toThrow();
  });

  it('keeps every channel as read', () => {
    const settings = { SMS: { status: 'active' }, Call: { status: 'active', message: 'm', code: 'c' } };
    expect(parseSmsBlock({ contact: { dndSettings: settings } }).settings).toEqual(settings);
  });
});

describe('allowSmsBody', () => {
  const current = {
    SMS: { status: 'active', message: 'old', code: 'x' },
    Call: { status: 'active', message: 'keep', code: 'c' },
    Email: { status: 'inactive', message: '', code: '' },
  };

  it('sends exactly one key, dndSettings', () => {
    expect(Object.keys(allowSmsBody(current, 'why'))).toEqual(['dndSettings']);
  });

  it('changes only texts and passes every other channel through unchanged', () => {
    const body = allowSmsBody(current, 'why');
    expect(body.dndSettings.SMS).toEqual({ status: 'inactive', message: 'why', code: '' });
    expect(body.dndSettings.Call).toEqual(current.Call);
    expect(body.dndSettings.Email).toEqual(current.Email);
  });

  it('does not change what it was given', () => {
    const copy = JSON.parse(JSON.stringify(current));
    allowSmsBody(current, 'why');
    expect(current).toEqual(copy);
  });

  it('shortens a long reason', () => {
    expect(allowSmsBody({}, 'x'.repeat(500)).dndSettings.SMS.message).toHaveLength(200);
  });
});

describe('otherChannelsChanged', () => {
  const before = { SMS: { status: 'active' }, Call: { status: 'active' }, Email: { status: 'inactive' } };

  it('is empty when only texts changed', () => {
    const after = { SMS: { status: 'inactive' }, Call: { status: 'active' }, Email: { status: 'inactive' } };
    expect(otherChannelsChanged(before, after)).toEqual([]);
  });

  it('names a channel that was reset', () => {
    const after = { SMS: { status: 'inactive' }, Email: { status: 'inactive' } };
    expect(otherChannelsChanged(before, after)).toEqual(['Call']);
  });

  it('ignores case and a channel that was never set', () => {
    expect(otherChannelsChanged({ Call: { status: 'Active' } }, { Call: { status: 'active' } })).toEqual([]);
    expect(otherChannelsChanged({}, { WhatsApp: { status: 'inactive' } })).toEqual([]);
  });
});
