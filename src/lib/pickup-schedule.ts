export type PickupTemplate = 'pickup_morning' | 'pickup_reminder' | 'pickup_no_show_check';

export type PickupSchedule = {
  morningHour: number;
  reminderHour: number;
  finalHour: number;
  lastHour: number;
  minGapHours: number;
};

export const DEFAULT_SCHEDULE: PickupSchedule = {
  morningHour: 6,
  reminderHour: 10,
  finalHour: 14,
  lastHour: 19,
  minGapHours: 3,
};

export type PickupBooking = {
  stage: string;
  pickupDate: string;
  pickupSubmitted: boolean;
  sent: Partial<Record<PickupTemplate, Date>>;
};

export type Clock = { today: string; hour: number; now: Date };

export function nextPickupMessage(
  _booking: PickupBooking,
  _clock: Clock,
  _schedule: PickupSchedule = DEFAULT_SCHEDULE,
): PickupTemplate | null {
  return null;
}
