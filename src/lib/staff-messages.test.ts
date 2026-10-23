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
