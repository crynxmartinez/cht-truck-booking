import { describe, expect, it } from 'vitest';
import { renderStaff } from './staff-messages';

const base = {
  reference: 'CHT-PPX5GN',
  renterName: 'Jubilee Diamond',
  renterEmail: 'j@example.com',
  renterPhone: '+19515550101',
  truckCode: 'B',
  pickupDate: '2026-10-25',
  returnDate: '2026-10-27',
};

describe('truck_changed — what Diana is told', () => {
  const m = renderStaff('truck_changed', { ...base, detail: 'Truck A to Truck B' });

  it('leads with who and which truck, in the subject and the text', () => {
    expect(m.subject).toContain('Jubilee Diamond');
    expect(m.subject).toContain('Truck B');
    expect(m.sms).toContain('Truck B');
  });

  it('carries the from-and-to detail and a warning about the signed contract', () => {
    expect(m.email).toContain('Truck A to Truck B');
    expect(m.email.toLowerCase()).toContain('signed');
  });
});

describe('truck_changed — without a detail', () => {
  it('reads cleanly rather than printing an empty pair of brackets', () => {
    const m = renderStaff('truck_changed', { ...base, detail: null });
    expect(m.email).not.toContain('()');
    expect(m.email).not.toContain('null');
  });
});

describe('the confirmed alert follows the pickup-hour setting', () => {
  it('names the hour that is set, not a fixed 6 AM', async () => {
    const { applySettings } = await import('./settings-store');
    const { renderStaff } = await import('./staff-messages');
    applySettings({ pickupSmsHour: 8 });
    try {
      const r = renderStaff('confirmed', {
        reference: 'CHT-T', renterName: 'Ana Test', renterEmail: 'a@b.co', renterPhone: '555-010-0000',
        truckCode: 'A', pickupDate: '2026-12-03', returnDate: '2026-12-05',
      });
      const all = `${r.subject}\n${r.email}\n${r.sms}`;
      expect(all).toMatch(/8 AM/);
      expect(all).not.toMatch(/\b6 ?AM\b/);
    } finally {
      applySettings({});
    }
  });
});
