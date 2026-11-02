import type { Prisma, Stage } from '@prisma/client';
import { BOARD_STAGES } from './stages';

/**
 * What is on the Board, and what is in Past rentals.
 *
 * The Board is for rentals that need something done. A Completed rental stays
 * on it for a while, so the office can see it closed, and then moves off. It is
 * never deleted: Past rentals keeps every Completed and Cancelled rental, with
 * search. Pure query-building, so the rules can be tested without a database.
 */

const DAY_MS = 86_400_000;

export function completedCutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

const IN_PROGRESS: Stage[] = BOARD_STAGES.filter((s) => s !== 'COMPLETED');

/** The Board's query: everything in progress, plus Completed rentals closed since `cutoff`. */
export function boardWhere(cutoff: Date): Prisma.BookingWhereInput {
  return {
    OR: [
      { stage: { in: IN_PROGRESS } },
      {
        stage: 'COMPLETED',
        // A Completed rental with no completion time is judged by when it last
        // changed, so it cannot sit on the Board forever for want of a date.
        OR: [{ completedAt: { gte: cutoff } }, { completedAt: null, updatedAt: { gte: cutoff } }],
      },
    ],
  };
}

export const PAST_PAGE_SIZE = 50;
const MAX_SEARCH = 100;

export type PastShow = 'all' | 'completed' | 'cancelled';
export type PastParams = { q: string; show: PastShow; page: number };

type Raw = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));

/** The page's query string, made safe: unknown filters and bad page numbers fall back. */
export function parsePastParams(raw: Raw): PastParams {
  const q = first(raw.q).trim().slice(0, MAX_SEARCH);
  const showRaw = first(raw.show);
  const show: PastShow = showRaw === 'completed' || showRaw === 'cancelled' ? showRaw : 'all';
  const pageRaw = first(raw.page);
  const page = /^\d+$/.test(pageRaw) && Number(pageRaw) >= 1 ? Number(pageRaw) : 1;
  return { q, show, page };
}

export function pastWhere(p: PastParams): Prisma.BookingWhereInput {
  const stages: Stage[] = p.show === 'completed' ? ['COMPLETED'] : p.show === 'cancelled' ? ['CANCELLED'] : ['COMPLETED', 'CANCELLED'];
  const conditions: Prisma.BookingWhereInput[] = [{ stage: { in: stages } }];
  if (p.q) {
    const like = { contains: p.q, mode: 'insensitive' as const };
    conditions.push({
      OR: [{ firstName: like }, { lastName: like }, { email: like }, { phone: like }, { reference: like }],
    });
  }
  return { AND: conditions };
}

export const pastOrder = (): Prisma.BookingOrderByWithRelationInput[] => [{ updatedAt: 'desc' }, { createdAt: 'desc' }];
