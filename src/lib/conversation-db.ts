import { prisma } from './db';
import { buildThread, countUnread, unreadBookingIds, type ThreadItem } from './conversation';
import { INBOUND_TEMPLATE } from './inbound';

/** Database side of the conversation: loading a thread, and finding which cards have an unread reply. */

export const READ_EVENT = 'conversation_read';

export async function loadThread(bookingId: string): Promise<{ items: ThreadItem[]; unread: number }> {
  const [rows, legacy, lastRead] = await Promise.all([
    prisma.messageLog.findMany({
      where: { bookingId },
      orderBy: { createdAt: 'desc' },
      take: 300,
      select: {
        id: true, template: true, channel: true, status: true, recipientKey: true, toAddress: true,
        subject: true, body: true, error: true, sentAt: true, createdAt: true,
      },
    }),
    prisma.bookingEvent.findMany({
      where: { bookingId, type: 'inbound_message' },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, detail: true, createdAt: true },
    }),
    prisma.bookingEvent.findFirst({ where: { bookingId, type: READ_EVENT }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
  ]);
  return { items: buildThread(rows, legacy), unread: countUnread(rows, lastRead?.createdAt ?? null) };
}

/** Which of these bookings have a reply nobody has opened yet. */
export async function unreadFor(bookingIds: string[]): Promise<Set<string>> {
  if (bookingIds.length === 0) return new Set();
  const [replies, reads] = await Promise.all([
    prisma.messageLog.groupBy({
      by: ['bookingId'],
      where: { template: INBOUND_TEMPLATE, bookingId: { in: bookingIds } },
      _max: { createdAt: true },
    }),
    prisma.bookingEvent.groupBy({
      by: ['bookingId'],
      where: { type: READ_EVENT, bookingId: { in: bookingIds } },
      _max: { createdAt: true },
    }),
  ]);
  const newest = new Map<string, Date>();
  for (const r of replies) if (r._max.createdAt) newest.set(r.bookingId, r._max.createdAt);
  const lastRead = new Map<string, Date>();
  for (const r of reads) if (r._max.createdAt) lastRead.set(r.bookingId, r._max.createdAt);
  return unreadBookingIds(newest, lastRead);
}
