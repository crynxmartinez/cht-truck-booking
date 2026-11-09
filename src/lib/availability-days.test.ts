import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  trucks: vi.fn(),
  bookings: vi.fn(),
  blackouts: vi.fn(),
  txBookings: vi.fn(),
  txBlackouts: vi.fn(),
  txTrucks: vi.fn(),
  create: vi.fn(),
  queryRaw: vi.fn(),
}));

const tx = {
  $queryRaw: (...a: unknown[]) => mocks.queryRaw(...a),
  truck: { findMany: (...a: unknown[]) => mocks.txTrucks(...a) },
  booking: { findMany: (...a: unknown[]) => mocks.txBookings(...a), create: (...a: unknown[]) => mocks.create(...a) },
  blackoutDate: { findMany: (...a: unknown[]) => mocks.txBlackouts(...a) },
};

vi.mock('./db', () => ({
  prisma: {
    truck: { findMany: mocks.trucks },
    booking: { findMany: mocks.bookings },
    blackoutDate: { findMany: mocks.blackouts },
    $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
  },
}));

import { NoTruckAvailableError, createBookingWithTruck, getAvailability } from './availability';
import { applySettings } from './settings-store';

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const A = { id: 'truck-a', code: 'A' };
const B = { id: 'truck-b', code: 'B' };
const held = (truckId: string, from: string, to: string) => ({ truckId, blockStart: day(from), blockEnd: day(to) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  // 1 PM on Friday 30 Oct at the yard: tomorrow is the earliest a customer can book.
  vi.setSystemTime(new Date('2026-10-30T20:00:00Z'));
  mocks.trucks.mockResolvedValue([A, B]);
  mocks.bookings.mockResolvedValue([]);
  mocks.blackouts.mockResolvedValue([]);
  mocks.txTrucks.mockResolvedValue([A, B]);
  mocks.txBookings.mockResolvedValue([]);
  mocks.txBlackouts.mockResolvedValue([]);
  mocks.create.mockImplementation(async ({ data }: { data: { truckId: string } }) => ({ id: 'b1', ...data, truck: { code: data.truckId === 'truck-a' ? 'A' : 'B' } }));
});

afterEach(() => {
  vi.useRealTimers();
  applySettings({});
});

const on = async (iso: string) => (await getAvailability(iso, iso))[0];

describe('getAvailability — how many days a customer can take from each date', () => {
  it('offers the full length when nothing is booked', async () => {
    expect(await on('2026-11-10')).toMatchObject({ maxDays: 3, trucksFree: 2 });
  });

  it('your example: Nov 3 booked on one truck only, a 3-day rental from Nov 1 is still possible', async () => {
    mocks.bookings.mockResolvedValue([held('truck-a', '2026-11-03', '2026-11-05')]);
    expect(await on('2026-11-01')).toMatchObject({ maxDays: 3, trucksFree: 1 });
  });

  it('your example: Nov 3 booked on both trucks, Nov 1 is still offered, for 1 or 2 days', async () => {
    mocks.bookings.mockResolvedValue([held('truck-a', '2026-11-03', '2026-11-05'), held('truck-b', '2026-11-03', '2026-11-04')]);
    const d = await on('2026-11-01');
    expect(d.maxDays).toBe(2);
    // The old "free for the whole 3 days" count says closed; the new length says open.
    expect(d.trucksFree).toBe(0);
  });

  it('does not offer a date when both trucks are busy on that very day', async () => {
    mocks.bookings.mockResolvedValue([held('truck-a', '2026-11-01', '2026-11-02'), held('truck-b', '2026-10-30', '2026-11-01')]);
    expect(await on('2026-11-01')).toMatchObject({ maxDays: 0, trucksFree: 0 });
  });

  it('treats a blackout like a booking', async () => {
    mocks.blackouts.mockResolvedValue([
      { truckId: 'truck-a', startDate: day('2026-11-02'), endDate: day('2026-11-02') },
      { truckId: 'truck-b', startDate: day('2026-11-02'), endDate: day('2026-11-03') },
    ]);
    expect((await on('2026-11-01')).maxDays).toBe(1);
  });

  it('offers nothing before the earliest day, and nothing after the furthest', async () => {
    expect((await on('2026-10-30')).maxDays).toBe(0); // today: customers cannot book the same day
    expect((await on('2026-10-31')).maxDays).toBe(3); // tomorrow: they can
    expect((await on('2027-06-01')).maxDays).toBe(0);
  });

  it('follows the most-days setting', async () => {
    applySettings({ customerMaxDays: 2 });
    expect((await on('2026-11-10')).maxDays).toBe(2);
    applySettings({ customerMaxDays: 1 });
    expect((await on('2026-11-10')).maxDays).toBe(1);
  });

  it('follows the empty-days setting for customers', async () => {
    mocks.bookings.mockResolvedValue([held('truck-a', '2026-11-03', '2026-11-05'), held('truck-b', '2026-11-03', '2026-11-05')]);
    expect((await on('2026-11-01')).maxDays).toBe(2);
    applySettings({ bufferDays: 1 });
    expect((await on('2026-11-01')).maxDays).toBe(1);
  });

  it('keeps the old count for pages that were loaded before this change, judged on the house length', async () => {
    mocks.bookings.mockResolvedValue([held('truck-a', '2026-11-03', '2026-11-05')]);
    const d = await on('2026-11-01');
    expect(d.trucksFree).toBe(1);
    expect(d.freeTruckIds).toEqual(['truck-b']);
  });
});

describe('createBookingWithTruck — length and the tightest truck', () => {
  const person = { reference: 'CHT-X', firstName: 'A', lastName: 'B', email: 'a@b.co', phone: '+15555550100' };

  it('books the length asked for, and records the return date to match', async () => {
    await createBookingWithTruck({ ...person, pickupDate: '2026-11-10', days: 2 });
    const data = (mocks.create.mock.calls[0][0] as { data: Record<string, Date> }).data;
    expect(data.pickupDate).toEqual(day('2026-11-10'));
    expect(data.returnDate).toEqual(day('2026-11-11'));
    expect(data.blockEnd).toEqual(day('2026-11-11'));
  });

  it('gives a 2-day request the truck that is free for the least time, keeping the open one for a longer booking', async () => {
    mocks.txBookings.mockResolvedValue([held('truck-a', '2026-11-03', '2026-11-05')]);
    await createBookingWithTruck({ ...person, pickupDate: '2026-11-01', days: 2 });
    expect((mocks.create.mock.calls[0][0] as { data: { truckId: string } }).data.truckId).toBe('truck-a');
  });

  it('gives a 3-day request the only truck that fits', async () => {
    mocks.txBookings.mockResolvedValue([held('truck-a', '2026-11-03', '2026-11-05')]);
    await createBookingWithTruck({ ...person, pickupDate: '2026-11-01', days: 3 });
    expect((mocks.create.mock.calls[0][0] as { data: { truckId: string } }).data.truckId).toBe('truck-b');
  });

  it('says how many days ARE free when the length asked for is not', async () => {
    mocks.txBookings.mockResolvedValue([held('truck-a', '2026-11-03', '2026-11-05'), held('truck-b', '2026-11-03', '2026-11-05')]);
    const attempt = createBookingWithTruck({ ...person, pickupDate: '2026-11-01', days: 3 });
    await expect(attempt).rejects.toBeInstanceOf(NoTruckAvailableError);
    await expect(attempt).rejects.toThrow(/only 2 days are free/i);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('says "1 day" in the singular', async () => {
    mocks.txBookings.mockResolvedValue([held('truck-a', '2026-11-02', '2026-11-05'), held('truck-b', '2026-11-02', '2026-11-05')]);
    await expect(createBookingWithTruck({ ...person, pickupDate: '2026-11-01', days: 2 })).rejects.toThrow(/only 1 day is free/i);
  });

  it('uses the plain "taken" message when the very first day is gone', async () => {
    mocks.txBookings.mockResolvedValue([held('truck-a', '2026-11-01', '2026-11-05'), held('truck-b', '2026-11-01', '2026-11-05')]);
    await expect(createBookingWithTruck({ ...person, pickupDate: '2026-11-01', days: 2 })).rejects.toThrow(/was taken/i);
  });

  it('leaves the customer’s empty days alone when the office books, and respects them when asked to', async () => {
    mocks.txBookings.mockResolvedValue([held('truck-a', '2026-11-03', '2026-11-05'), held('truck-b', '2026-11-03', '2026-11-05')]);
    await createBookingWithTruck({ ...person, pickupDate: '2026-11-01', days: 2 }); // office: no buffer
    expect(mocks.create).toHaveBeenCalledTimes(1);
    await expect(createBookingWithTruck({ ...person, pickupDate: '2026-11-01', days: 2, buffer: 1 })).rejects.toBeInstanceOf(NoTruckAvailableError);
  });

  it('still honours the truck the office picked, and refuses rather than swap it for the other', async () => {
    mocks.txBookings.mockResolvedValue([held('truck-b', '2026-11-02', '2026-11-04')]);
    await createBookingWithTruck({ ...person, pickupDate: '2026-11-01', days: 1, preferTruckId: 'truck-b', mustUseTruck: true });
    expect((mocks.create.mock.calls[0][0] as { data: { truckId: string } }).data.truckId).toBe('truck-b');
    await expect(
      createBookingWithTruck({ ...person, pickupDate: '2026-11-02', days: 1, preferTruckId: 'truck-b', mustUseTruck: true }),
    ).rejects.toThrow(/Truck B is not free/);
  });

  it('still says bookings are paused when no truck is switched on', async () => {
    mocks.txTrucks.mockResolvedValue([]);
    await expect(createBookingWithTruck({ ...person, pickupDate: '2026-11-10', days: 1 })).rejects.toThrow('We are not taking new bookings right now.');
  });
});
