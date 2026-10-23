import { describe, expect, it } from 'vitest';
import { hourLabel, render, type MessageContext } from './messages';

const ctx: MessageContext = {
  firstName: 'Ryan',
  reference: 'CHT-PPX5GN',
  truckCode: 'A',
  pickupDate: '2026-10-09',
  returnDate: '2026-10-11',
  lockboxCode: '48213',
  pickupChecklistToken: 'tok_pickup_123',
};

describe('pickup messages repeat the details a renter at the truck needs', () => {
  it.each(['pickup_reminder', 'pickup_no_show_check'] as const)(
    '%s carries the code and the checklist link in both email and text',
    (key) => {
      const m = render(key, ctx);
      expect(m.email).toContain('48213');
      expect(m.sms).toContain('48213');
      expect(m.email).toContain('tok_pickup_123');
      expect(m.sms).toContain('tok_pickup_123');
    },
  );

  it.each(['pickup_reminder', 'pickup_no_show_check'] as const)(
    '%s tells someone who already has the truck to ignore it',
    (key) => {
      const m = render(key, ctx);
      expect(m.email.toLowerCase()).toContain('disregard');
      expect(m.sms.toLowerCase()).toContain('disregard');
    },
  );

  it('the first message is not a reminder, so it has no disregard line', () => {
    const m = render('pickup_morning', ctx);
    expect(m.email.toLowerCase()).not.toContain('disregard');
    expect(m.sms.toLowerCase()).not.toContain('disregard');
  });

  it('the code can arrive at any hour, so it never opens with "Good morning"', () => {
    const m = render('pickup_morning', ctx);
    expect(m.email).not.toContain('Good morning');
    expect(m.sms).not.toContain('Good morning');
    expect(m.email.startsWith('Hi Ryan')).toBe(true);
  });

  it('still says so plainly when no code is on file rather than printing "undefined"', () => {
    const m = render('pickup_reminder', { ...ctx, lockboxCode: null });
    expect(m.email).not.toContain('undefined');
    expect(m.sms).not.toContain('undefined');
  });
});

describe('truck_changed — the renter is told when their truck changes', () => {
  const changed = render('truck_changed', { ...ctx, truckCode: 'B' });

  it('names the new truck in both email and text', () => {
    expect(changed.email).toContain('Truck B');
    expect(changed.sms).toContain('Truck B');
  });

  it('says the dates and pickup address have not changed', () => {
    expect(changed.email.toLowerCase()).toContain('unchanged');
    expect(changed.email).toContain('Oct');
  });

  it('does not send a lockbox code early — it differs per truck and goes out on the day', () => {
    expect(changed.email).not.toContain('48213');
    expect(changed.sms).not.toContain('48213');
    expect(changed.email).toContain('6 AM');
  });

  it('has a subject that says what happened', () => {
    expect(changed.subject.toLowerCase()).toContain('truck');
  });
});

describe('truck_changed — the renter is told about their signed agreement', () => {
  it('says the agreement was issued for the earlier truck, so the lockbox is not the first they hear of it', () => {
    const m = render('truck_changed', { ...ctx, truckCode: 'B' });
    expect(m.email.toLowerCase()).toContain('signed rental agreement');
    expect(m.email.toLowerCase()).toContain('earlier truck');
  });
});

describe('hourLabel — the pickup text hour is configurable, so copy must not hard-code it', () => {
  it.each([
    [0, '12 AM'],
    [6, '6 AM'],
    [12, '12 PM'],
    [14, '2 PM'],
    [23, '11 PM'],
  ])('%i -> %s', (hour, label) => {
    expect(hourLabel(hour)).toBe(label);
  });
});
