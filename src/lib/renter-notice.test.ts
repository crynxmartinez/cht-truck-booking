import { describe, expect, it } from 'vitest';
import { renterNotice } from './renter-notice';

const BEFORE_COLLECTION = ['NEW_BOOKING', 'CONTRACT_SENT', 'ADDITIONAL_DRIVER', 'AWAITING_APPROVAL', 'CONFIRMED', 'PICKUP_DAY'];
const AFTER = ['IN_USE', 'RETURNED', 'COMPLETED', 'CANCELLED'];

describe('renterNotice — should the renter be told this booking is off?', () => {
  it('says nothing unless the office or the system asked for it', () => {
    for (const stage of BEFORE_COLLECTION) {
      expect(renterNotice(false, stage), stage).toBeNull();
      expect(renterNotice(undefined, stage), stage).toBeNull();
    }
  });

  it('uses the cancellation message for an office cancellation', () => {
    for (const stage of BEFORE_COLLECTION) expect(renterNotice('cancelled', stage), stage).toBe('booking_cancelled');
  });

  it('uses the released message for a truck let go because paperwork was never signed', () => {
    for (const stage of ['NEW_BOOKING', 'CONTRACT_SENT', 'ADDITIONAL_DRIVER']) {
      expect(renterNotice('released', stage), stage).toBe('booking_released');
    }
  });

  it('never says "released for want of a signature" to a renter who has signed everything and been approved', () => {
    for (const stage of ['AWAITING_APPROVAL', 'CONFIRMED', 'PICKUP_DAY']) {
      expect(renterNotice('released', stage), stage).toBeNull();
    }
  });

  it('never sends one once the renter has the truck, or the rental is over or already cancelled', () => {
    // "Your rental is cancelled" to someone driving the truck would be wrong and alarming.
    for (const stage of AFTER) {
      expect(renterNotice('cancelled', stage), stage).toBeNull();
      expect(renterNotice('released', stage), stage).toBeNull();
    }
  });

  it('does not send for a stage it does not know', () => {
    expect(renterNotice('cancelled', 'SOMETHING_NEW')).toBeNull();
  });
});
