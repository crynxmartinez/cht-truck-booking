import { getAvailability } from '@/lib/availability';
import { isIsoDate, todayInOps, addDays, latestBookable } from '@/lib/dates';
import { json, preflight, clientIp, rateLimit } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(req: Request) {
  return preflight(req.headers.get('origin'));
}

/**
 * GET /api/public/availability?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns a map the widget can index straight into:
 *   { days: { "2026-09-01": { trucksFree: 2 }, ... } }
 *
 * Truck ids are deliberately not exposed — the public has no business knowing
 * which vehicle is free, only whether a date can be booked.
 */
export async function GET(req: Request) {
  const origin = req.headers.get('origin');

  const limit = rateLimit(`avail:${clientIp(req)}`, 120, 60_000);
  if (!limit.ok) return json({ error: 'Too many requests.' }, { status: 429, origin });

  const url = new URL(req.url);
  const today = todayInOps();
  const from = url.searchParams.get('from') ?? today;
  const to = url.searchParams.get('to') ?? addDays(today, 45);

  if (!isIsoDate(from) || !isIsoDate(to) || from > to) {
    return json({ error: 'Invalid date range.' }, { status: 400, origin });
  }

  // Cap the span so nobody asks for five years in one call.
  const hardEnd = latestBookable();
  const cappedTo = to > hardEnd ? hardEnd : to;
  if (from > cappedTo) {
    return json({ days: {} }, { origin });
  }

  try {
    const days = await getAvailability(from, cappedTo);
    const map: Record<string, { trucksFree: number }> = {};
    for (const d of days) map[d.date] = { trucksFree: d.trucksFree };

    return json(
      { days: map, earliest: addDays(today, 0), horizon: hardEnd },
      { origin },
    );
  } catch (err) {
    console.error('availability failed', err);
    return json({ error: 'Could not load availability.' }, { status: 500, origin });
  }
}
