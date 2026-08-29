import { prisma } from '@/lib/db';
import { clientIp, json, rateLimit } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/checklist/[token]/draft — autosave.
 *
 * Called on a debounce as the renter types. This is what lets us drop the
 * "do not close this page or you will lose your progress" warning from the
 * original form: if they lose signal, they come back to where they were.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const limit = rateLimit(`draft:${clientIp(req)}`, 200, 10 * 60_000);
  if (!limit.ok) return json({ ok: false }, { status: 429 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false }, { status: 400 });
  }

  const draft = body?.draft;
  if (!draft || typeof draft !== 'object') return json({ ok: false }, { status: 400 });

  // Keep the blob small; this is a convenience cache, not a record.
  const serialised = JSON.stringify(draft);
  if (serialised.length > 20_000) return json({ ok: false, error: 'Draft too large' }, { status: 413 });

  const res = await prisma.checklist.updateMany({
    where: { token, submittedAt: null },
    data: { draft: JSON.parse(serialised) },
  });

  return json({ ok: res.count > 0 });
}
