import { json, preflight, clientIp, rateLimit } from '@/lib/http';
import { newDraftId } from '@/lib/tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Hands the widget a draft id so uploads can be parked before the booking row
 * exists. Cheap and stateless — the id is only meaningful once documents are
 * attached to it.
 */

export async function OPTIONS(req: Request) {
  return preflight(req.headers.get('origin'));
}

export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  const limit = rateLimit(`session:${clientIp(req)}`, 30, 60_000);
  if (!limit.ok) {
    return json({ error: 'Too many requests. Try again in a moment.' }, { status: 429, origin });
  }
  return json({ draftId: newDraftId() }, { origin });
}
