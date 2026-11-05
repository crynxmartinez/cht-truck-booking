import { describe, expect, it } from 'vitest';
import { config } from './config';
import { LOCKBOX_PLACEHOLDER, messageCatalog } from './message-catalog';
import type { TemplateKey } from './messages';
import type { StaffEvent } from './staff-messages';

const RENTER: TemplateKey[] = [
  'booking_received',
  'contract_to_sign',
  'contract_nudge',
  'additional_driver',
  'dates_changed',
  'truck_changed',
  'rental_confirmed',
  'pickup_morning',
  'pickup_reminder',
  'pickup_no_show_check',
  'return_day',
  'overdue',
  'booking_cancelled',
  'booking_released',
  'thank_you',
];

const OFFICE: StaffEvent[] = [
  'booking_received',
  'additional_driver_invited',
  'awaiting_approval',
  'confirmed',
  'picked_up',
  'returned',
  'reschedule_requested',
  'overdue',
  'dates_changed',
  'truck_changed',
  'cancelled',
];

const entries = messageCatalog();
const renter = entries.filter((e) => e.audience === 'renter');
const office = entries.filter((e) => e.audience === 'office');

describe('messageCatalog — every message the system can send, readable in one place', () => {
  it('lists every renter message', () => {
    expect(renter.map((e) => e.key).sort()).toEqual([...RENTER].sort());
  });

  it('lists every office alert', () => {
    expect(office.map((e) => e.key).sort()).toEqual([...OFFICE].sort());
  });

  it('says in plain English when each one is sent', () => {
    for (const e of entries) {
      expect(e.title.length).toBeGreaterThan(3);
      expect(e.when.length).toBeGreaterThan(15);
    }
  });

  it('shows the actual wording of each one', () => {
    for (const e of entries) {
      expect(e.sms.length + e.email.length).toBeGreaterThan(20);
      expect(e.subject.length).toBeGreaterThan(0);
    }
  });

  it('never prints a blank or broken value into a sample', () => {
    for (const e of entries) {
      const all = `${e.subject}\n${e.email}\n${e.sms}`;
      expect(all, `${e.audience}:${e.key}`).not.toMatch(/undefined|\bnull\b|NaN|\[object/);
    }
  });

  it('never shows a real lockbox code, only a marker', () => {
    const pickup = renter.find((e) => e.key === 'pickup_morning')!;
    expect(`${pickup.email}${pickup.sms}`).toContain(LOCKBOX_PLACEHOLDER);
    // The yard's ZIP code is five digits too; it is not a lockbox code.
    for (const e of entries) {
      const text = `${e.email}${e.sms}`.split(config.pickupAddress).join('');
      expect(text, `${e.audience}:${e.key}`).not.toMatch(/\b\d{5}\b/);
    }
  });

  it('uses an obviously fake renter, so a sample can never be mistaken for a real message', () => {
    const first = renter[0];
    expect(`${first.email}${first.sms}`).toMatch(/Sample/);
  });

  it('keeps the text of a button readable, not the raw marker', () => {
    for (const e of entries) {
      expect(`${e.email}${e.sms}`).not.toMatch(/\[\[|\]\]/);
    }
  });
});
