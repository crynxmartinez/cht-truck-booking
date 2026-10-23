import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queryRaw = vi.fn();
const findBooking = vi.fn();
const findTruck = vi.fn();
const findClash = vi.fn();
const findBlackout = vi.fn();
const updateBooking = vi.fn();
const countCodes = vi.fn();

const tx = {
  $queryRaw: (...a: unknown[]) => queryRaw(...a),
  booking: {
    findUniqueOrThrow: (...a: unknown[]) => findBooking(...a),
    findFirst: (...a: unknown[]) => findClash(...a),
    update: (...a: unknown[]) => updateBooking(...a),
  },
  truck: { findUnique: (...a: unknown[]) => findTruck(...a) },
  blackoutDate: { findFirst: (...a: unknown[]) => findBlackout(...a) },
  // Has this booking's pickup-day lockbox code gone out (or started going out)?
  messageLog: { count: (...a: unknown[]) => countCodes(...a) },
};

vi.mock('./db', () => ({
  prisma: { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) },
}));

import { NoTruckAvailableError, SwapNotAllowedError, reassignTruck } from './availability';

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

function accepted(over: Record<string, unknown> = {}) {
  findBooking.mockResolvedValue({
    id: 'b1',
    stage: 'CONFIRMED',
    truckId: 'truck-a',
    truck: { code: 'A' },
    pickupDate: day('2026-10-25'),
    blockStart: day('2026-10-25'),
    blockEnd: day('2026-10-27'),
    ...over,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // 11 AM at the yard on Friday 23 October.
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-23T18:00:00Z'));
  accepted();
  findTruck.mockResolvedValue({ id: 'truck-b', code: 'B', active: true });
  findClash.mockResolvedValue(null);
  findBlackout.mockResolvedValue(null);
  countCodes.mockResolvedValue(0);
  updateBooking.mockResolvedValue({ id: 'b1', truckId: 'truck-b', truck: { code: 'B' } });
});

afterEach(() => vi.useRealTimers());

describe('reassignTruck — the guard lives with the data, not just the button', () => {
  it('moves an accepted booking whose pickup is still ahead, and says where it came from', async () => {
    const res = await reassignTruck('b1', 'truck-b');
    expect(updateBooking).toHaveBeenCalledWith(expect.objectContaining({ data: { truckId: 'truck-b' } }));
    expect(res.truck?.code).toBe('B');
    expect(res.previousTruckCode).toBe('A');
  });

  it.each(['NEW_BOOKING', 'CONTRACT_SENT', 'AWAITING_APPROVAL'])(
    'moves a %s booking too — it only has to be before its booking period',
    async (stage) => {
      accepted({ stage });
      await expect(reassignTruck('b1', 'truck-b')).resolves.toBeDefined();
      expect(updateBooking).toHaveBeenCalled();
    },
  );

  it.each(['PICKUP_DAY', 'IN_USE', 'RETURNED', 'CANCELLED'])(
    'refuses a %s booking and changes nothing',
    async (stage) => {
      accepted({ stage });
      await expect(reassignTruck('b1', 'truck-b')).rejects.toBeInstanceOf(SwapNotAllowedError);
      expect(updateBooking).not.toHaveBeenCalled();
    },
  );

  it('moves a booking whose pickup is today while the lockbox code has not gone out', async () => {
    accepted({ pickupDate: day('2026-10-23'), blockStart: day('2026-10-23'), blockEnd: day('2026-10-25') });
    await expect(reassignTruck('b1', 'truck-b')).resolves.toBeDefined();
  });

  it('refuses a pickup that is today once the code is out — the renter holds the other truck’s code', async () => {
    accepted({ pickupDate: day('2026-10-23'), blockStart: day('2026-10-23'), blockEnd: day('2026-10-25') });
    countCodes.mockResolvedValue(1);
    await expect(reassignTruck('b1', 'truck-b')).rejects.toBeInstanceOf(SwapNotAllowedError);
    expect(updateBooking).not.toHaveBeenCalled();
  });

  it('only counts a code that was queued or sent, not one that failed', async () => {
    accepted({ pickupDate: day('2026-10-23'), blockStart: day('2026-10-23'), blockEnd: day('2026-10-25') });
    await reassignTruck('b1', 'truck-b');
    const arg = countCodes.mock.calls[0][0] as { where: { template: string; status: { in: string[] } } };
    expect(arg.where.template).toBe('pickup_morning');
    expect([...arg.where.status.in].sort()).toEqual(['QUEUED', 'SENT']);
  });

  it('refuses a pickup date that has already passed', async () => {
    accepted({ pickupDate: day('2026-10-22'), blockStart: day('2026-10-22'), blockEnd: day('2026-10-24') });
    await expect(reassignTruck('b1', 'truck-b')).rejects.toBeInstanceOf(SwapNotAllowedError);
  });

  it('refuses a truck that is switched off', async () => {
    findTruck.mockResolvedValue({ id: 'truck-b', code: 'B', active: false });
    await expect(reassignTruck('b1', 'truck-b')).rejects.toThrow(/Truck B/);
    expect(updateBooking).not.toHaveBeenCalled();
  });

  it('refuses a truck that does not exist', async () => {
    findTruck.mockResolvedValue(null);
    await expect(reassignTruck('b1', 'nope')).rejects.toBeInstanceOf(NoTruckAvailableError);
    expect(updateBooking).not.toHaveBeenCalled();
  });

  it('still refuses when the other truck is already out on those dates', async () => {
    findClash.mockResolvedValue({ reference: 'CHT-OTHER' });
    await expect(reassignTruck('b1', 'truck-b')).rejects.toThrow(/CHT-OTHER/);
    expect(updateBooking).not.toHaveBeenCalled();
  });

  it('still refuses when the other truck is blacked out', async () => {
    findBlackout.mockResolvedValue({ reason: 'service' });
    await expect(reassignTruck('b1', 'truck-b')).rejects.toBeInstanceOf(NoTruckAvailableError);
    expect(updateBooking).not.toHaveBeenCalled();
  });
});

describe('reassignTruck — locking and boundaries', () => {
  it('locks the trucks and then the booking row, before reading the booking', async () => {
    await reassignTruck('b1', 'truck-b');
    expect(queryRaw).toHaveBeenCalledTimes(2);
    const lastLock = Math.max(...queryRaw.mock.invocationCallOrder);
    expect(lastLock).toBeLessThan(findBooking.mock.invocationCallOrder[0]);
  });

  it('refuses a booking that is already on that truck, at the data layer too', async () => {
    findTruck.mockResolvedValue({ id: 'truck-a', code: 'A', active: true });
    await expect(reassignTruck('b1', 'truck-a')).rejects.toThrow(/already on Truck A/);
    expect(updateBooking).not.toHaveBeenCalled();
  });

  it('looks for a clash on the target truck, ignoring this booking itself', async () => {
    await reassignTruck('b1', 'truck-b');
    expect(findClash).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { not: 'b1' },
          truckId: 'truck-b',
          blockStart: { lte: day('2026-10-27') },
          blockEnd: { gte: day('2026-10-25') },
        }),
      }),
    );
  });

  it('still counts the 24th as ahead at 10:30 PM on the 23rd at the yard, though UTC has rolled over', async () => {
    vi.setSystemTime(new Date('2026-10-24T05:30:00Z')); // 22:30 PDT on the 23rd
    accepted({ pickupDate: day('2026-10-24'), blockStart: day('2026-10-24'), blockEnd: day('2026-10-26') });
    await expect(reassignTruck('b1', 'truck-b')).resolves.toBeDefined();
  });

  it('treats the 24th as today once it is 1 AM there, so a sent code now blocks it', async () => {
    vi.setSystemTime(new Date('2026-10-24T08:00:00Z')); // 01:00 PDT on the 24th
    countCodes.mockResolvedValue(1);
    accepted({ pickupDate: day('2026-10-24'), blockStart: day('2026-10-24'), blockEnd: day('2026-10-26') });
    await expect(reassignTruck('b1', 'truck-b')).rejects.toBeInstanceOf(SwapNotAllowedError);
  });
});
