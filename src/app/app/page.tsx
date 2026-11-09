import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { customerDefaultDays } from '@/lib/booking-rules';
import { boardWhere, completedCutoff } from '@/lib/board-window';
import { loadSettings } from '@/lib/settings';
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
  await loadSettings();
  const cutoff = completedCutoff(new Date(), config.completedHideDays);
  const [bookings, trucks] = await Promise.all([
    prisma.booking.findMany({
      where: boardWhere(cutoff),
      include: { truck: { select: { code: true } } },
      orderBy: [{ pickupDate: 'asc' }, { createdAt: 'asc' }],
      take: 500,
    }),
    prisma.truck.findMany({ where: { active: true }, select: { id: true, code: true }, orderBy: { code: 'asc' } }),
  ]);

  return (
    <Board
      cards={bookings.map(toCard)}
      trucks={trucks}
      defaultDays={customerDefaultDays(config.customerMaxDays, config.rentalBlockDays)}
      dragEnabled={config.boardDrag}
      loadDetail={loadDetail}
    />
  );
}
