import { prisma } from './db';

/**
 * Dealing with failed messages without losing the record of them.
 *
 * "Mark handled" means the office has dealt with it (phoned the renter, or it
 * was a test). The row, its error and its text all stay. Only the Needs
 * attention list stops showing it, so a real problem is no longer buried
 * under old ones.
 */

export const MAX_HANDLED_AT_ONCE = 100;
const SHOWN = 100;

export type HandledResult = { ok: true; count: number } | { ok: false; error: string };

export async function markHandled(ids: unknown, by: string): Promise<HandledResult> {
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((i) => typeof i !== 'string' || !i)) {
    return { ok: false, error: 'Nothing was chosen to mark as handled.' };
  }
  const unique = Array.from(new Set(ids as string[]));
  if (unique.length > MAX_HANDLED_AT_ONCE) {
    return { ok: false, error: `Choose at most ${MAX_HANDLED_AT_ONCE} at a time.` };
  }

  const res = await prisma.messageLog.updateMany({
    // Only failures that are still open: a message that was resent and went out,
    // or one already handled, is left exactly as it is.
    where: { id: { in: unique }, status: 'FAILED', handledAt: null },
    data: { handledAt: new Date(), handledBy: by },
  });
  return { ok: true, count: res.count };
}

export function handledFilter(showHandled: boolean) {
  return showHandled
    ? ({ status: 'FAILED', handledAt: { not: null } } as const)
    : ({ status: 'FAILED', handledAt: null } as const);
}

/** The failures to show on Needs attention: open ones, or (on request) the ones already handled. */
export function openFailures(showHandled: boolean) {
  return prisma.messageLog.findMany({
    where: handledFilter(showHandled),
    include: {
      booking: { select: { reference: true, firstName: true, lastName: true, stage: true, pickupDate: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: SHOWN,
  });
}
