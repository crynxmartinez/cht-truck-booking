import type { Prisma } from '@prisma/client';

/**
 * Finding someone who has rented before, so the office does not retype them.
 *
 * Pure: it builds the search and tidies the answer, and the database call
 * sits in the office action. A repeat renter appears once, with their most
 * recent details, however many times they have booked.
 */

const MIN_LENGTH = 3;
const MAX_WORDS = 4;

export function renterWhere(query: string): Prisma.BookingWhereInput | null {
  const q = query.trim();
  if (q.length < MIN_LENGTH) return null;

  // Something that looks like a phone number is matched on its digits, so
  // "(562) 556-8184" finds "+15625568184".
  if (/^[\d\s()+.-]+$/.test(q)) {
    const digits = q.replace(/\D/g, '');
    return digits.length >= 4 ? { phone: { contains: digits } } : null;
  }

  const words = q.split(/\s+/).filter(Boolean).slice(0, MAX_WORDS);
  return {
    AND: words.map((w) => {
      const like = { contains: w, mode: 'insensitive' as const };
      return { OR: [{ firstName: like }, { lastName: like }, { email: like }, { phone: like }] };
    }),
  };
}

export type Renter = { name: string; email: string; phone: string };

type Row = { firstName: string; lastName: string; email: string; phone: string };

/** Rows newest first in; one suggestion per email address out. */
export function distinctRenters(rows: Row[], limit = 5): Renter[] {
  const seen = new Set<string>();
  const out: Renter[] = [];
  for (const r of rows) {
    const key = r.email.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: `${r.firstName} ${r.lastName}`.trim(), email: key, phone: r.phone });
    if (out.length >= limit) break;
  }
  return out;
}
