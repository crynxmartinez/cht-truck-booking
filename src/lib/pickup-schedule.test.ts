import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCHEDULE,
  nextPickupMessage,
  type Clock,
  type PickupBooking,
} from './pickup-schedule';

const TODAY = '2026-10-09';

/** A wall-clock moment at the yard, as the cron would see it. */
function at(hour: number, minute = 0, today = TODAY): Clock {
  const now = new Date(`${today}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`);
  return { today, hour, now };
}

const sentAt = (hour: number, minute = 0) => at(hour, minute).now;

function booking(over: Partial<PickupBooking> = {}): PickupBooking {
  return { stage: 'CONFIRMED', pickupDate: TODAY, pickupSubmitted: false, sent: {}, ...over };
}

describe('nextPickupMessage — the code itself', () => {
  it('sends the code at 6 AM to a confirmed booking picking up today', () => {
    expect(nextPickupMessage(booking(), at(6))).toBe('pickup_morning');
  });

  it('waits until 6 AM — nobody is texted a lockbox code at 5', () => {
    expect(nextPickupMessage(booking(), at(5))).toBeNull();
  });

  it('does nothing for a booking that is not picking up today', () => {
    expect(nextPickupMessage(booking({ pickupDate: '2026-10-10' }), at(6))).toBeNull();
    expect(nextPickupMessage(booking({ pickupDate: '2026-10-08' }), at(6))).toBeNull();
  });

  it.each([7, 10, 13, 17, 22])(
    'still sends the code when approval lands late, at %i:00 (the Ryan Tripp case)',
    (hour) => {
      expect(nextPickupMessage(booking(), at(hour))).toBe('pickup_morning');
    },
  );

  it('does not wait on a booking that has not been approved yet', () => {
    expect(nextPickupMessage(booking({ stage: 'AWAITING_APPROVAL' }), at(6))).toBeNull();
    expect(nextPickupMessage(booking({ stage: 'CONTRACT_SENT' }), at(10))).toBeNull();
  });

  it.each(['CANCELLED', 'COMPLETED', 'RETURNED', 'IN_USE'])('ignores a %s booking', (stage) => {
    expect(nextPickupMessage(booking({ stage }), at(6))).toBeNull();
  });
});

describe('nextPickupMessage — the reminders', () => {
  const afterMorning = (over: Partial<PickupBooking> = {}) =>
    booking({ stage: 'PICKUP_DAY', sent: { pickup_morning: sentAt(6) }, ...over });

  it('does not repeat the code in the hours after it was sent', () => {
    expect(nextPickupMessage(afterMorning(), at(7))).toBeNull();
    expect(nextPickupMessage(afterMorning(), at(9, 59))).toBeNull();
  });

  it('sends the first reminder at 10 AM if they have not picked up', () => {
    expect(nextPickupMessage(afterMorning(), at(10))).toBe('pickup_reminder');
  });

  it('sends nothing once the pickup checklist is in — they have the truck', () => {
    expect(nextPickupMessage(afterMorning({ pickupSubmitted: true }), at(10))).toBeNull();
    expect(nextPickupMessage(afterMorning({ pickupSubmitted: true }), at(15))).toBeNull();
  });

  it('stops once the truck is out', () => {
    expect(nextPickupMessage(afterMorning({ stage: 'IN_USE' }), at(10))).toBeNull();
  });

  it('still reminds if the stage move after the code failed and it is still CONFIRMED', () => {
    expect(nextPickupMessage(afterMorning({ stage: 'CONFIRMED' }), at(10))).toBe('pickup_reminder');
  });

  it('sends the final check at 2 PM after the 10 AM reminder', () => {
    const b = afterMorning({ sent: { pickup_morning: sentAt(6), pickup_reminder: sentAt(10) } });
    expect(nextPickupMessage(b, at(14))).toBe('pickup_no_show_check');
  });

  it('holds the final check until 2 PM', () => {
    const b = afterMorning({ sent: { pickup_morning: sentAt(6), pickup_reminder: sentAt(10) } });
    expect(nextPickupMessage(b, at(12))).toBeNull();
    expect(nextPickupMessage(b, at(13, 59))).toBeNull();
  });

  it('sends nothing after all three have gone', () => {
    const b = afterMorning({
      sent: {
        pickup_morning: sentAt(6),
        pickup_reminder: sentAt(10),
        pickup_no_show_check: sentAt(14),
      },
    });
    expect(nextPickupMessage(b, at(15))).toBeNull();
    expect(nextPickupMessage(b, at(18))).toBeNull();
  });
});

describe('nextPickupMessage — a late approver is not buried', () => {
  it('spaces the reminder at least three hours after a late code', () => {
    const b = booking({ stage: 'PICKUP_DAY', sent: { pickup_morning: sentAt(9, 30) } });
    expect(nextPickupMessage(b, at(10))).toBeNull(); // 30 minutes after the code
    expect(nextPickupMessage(b, at(11, 59))).toBeNull(); // 2h29m
    expect(nextPickupMessage(b, at(12, 30))).toBe('pickup_reminder'); // exactly 3h
  });

  it('then spaces the final check three hours after the reminder', () => {
    const b = booking({
      stage: 'PICKUP_DAY',
      sent: { pickup_morning: sentAt(13, 30), pickup_reminder: sentAt(16, 35) },
    });
    expect(nextPickupMessage(b, at(17))).toBeNull();
    expect(nextPickupMessage(b, at(19, 40))).toBe('pickup_no_show_check');
  });

  it('stops chasing after 7 PM', () => {
    const b = booking({ stage: 'PICKUP_DAY', sent: { pickup_morning: sentAt(15) } });
    expect(nextPickupMessage(b, at(19))).toBe('pickup_reminder');
    expect(nextPickupMessage(b, at(20))).toBeNull();
    expect(nextPickupMessage(b, at(23))).toBeNull();
  });
});

describe('nextPickupMessage — configuration', () => {
  it('honours a custom schedule', () => {
    const custom = { ...DEFAULT_SCHEDULE, morningHour: 7, reminderHour: 11 };
    expect(nextPickupMessage(booking(), at(6), custom)).toBeNull();
    expect(nextPickupMessage(booking(), at(7), custom)).toBe('pickup_morning');
  });
});
