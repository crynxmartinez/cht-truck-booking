import { prisma } from '@/lib/db';
import { BOARD_STAGES } from '@/lib/stages';
import { Board } from './Board';
import type { BookingDetail } from './types';
import { loadBookingDetail, toCard } from './detail';

export const dynamic = 'force-dynamic';

/** Called from the board when a card opens. */
async function loadDetail(id: string): Promise<BookingDetail | null> {
  'use server';
  return loadBookingDetail(id);
}

export default async function BoardPage() {
  const [bookings, trucks] = await Promise.all([
    prisma.booking.findMany({
      where: { stage: { in: BOARD_STAGES } },
      include: { truck: { select: { code: true } } },
      orderBy: [{ pickupDate: 'asc' }, { createdAt: 'asc' }],
      take: 500,
    }),
    prisma.truck.findMany({ where: { active: true }, select: { id: true, code: true }, orderBy: { code: 'asc' } }),
  ]);

  return <Board cards={bookings.map(toCard)} trucks={trucks} loadDetail={loadDetail} />;
}
