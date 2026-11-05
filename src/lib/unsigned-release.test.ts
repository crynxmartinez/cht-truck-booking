import { describe, expect, it } from 'vitest';
import { UNSIGNED_STAGES, unsignedReleaseWhere } from './unsigned-release';

const cutoff = new Date('2026-11-02T09:00:00Z');

describe('unsignedReleaseWhere — which unsigned bookings the daily sweep lets go', () => {
  const where = unsignedReleaseWhere(cutoff) as {
    stage: { in: string[] };
    createdAt: { lte: Date };
    NOT: { events: { some: { type: string; createdAt: { gt: Date } } } };
  };

  it('looks only at bookings still waiting on a signature', () => {
    expect(where.stage.in).toEqual(['CONTRACT_SENT', 'ADDITIONAL_DRIVER']);
    expect(UNSIGNED_STAGES).toEqual(where.stage.in);
  });

  it('only those booked longer ago than the cut-off', () => {
    expect(where.createdAt).toEqual({ lte: cutoff });
  });

  it('never one that was reopened since the cut-off, since the clock restarts when the office puts it back', () => {
    // Otherwise a booking the office reopens at 8 AM is released again at 9 AM, and
    // the renter is told "released" straight after being told they can have it back.
    expect(where.NOT).toEqual({ events: { some: { type: 'reopened', createdAt: { gt: cutoff } } } });
  });
});
