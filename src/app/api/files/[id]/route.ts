import { prisma } from '@/lib/db';
import { json } from '@/lib/http';
import { readBlob } from '@/lib/storage';
import { verifyFileSignature } from '@/lib/file-urls';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/files/<documentId>?e=<expiry>&s=<signature>
 *
 * The only way a stored file reaches a browser. Blobs are private, so this
 * route is the gate: it checks the signature, then streams the bytes through.
 * Links expire, which means a forwarded screenshot or a stale browser-history
 * entry stops working — the thing a public blob URL can never do.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);

  const check = verifyFileSignature(id, url.searchParams.get('e'), url.searchParams.get('s'));
  if (!check.ok) {
    const message =
      check.reason === 'expired'
        ? 'This link has expired. Reopen the booking to get a fresh one.'
        : 'This link is not valid.';
    return json({ error: message }, { status: check.reason === 'expired' ? 410 : 403 });
  }

  const doc = await prisma.document.findUnique({
    where: { id },
    select: { pathname: true, contentType: true, deletedAt: true },
  });
  if (!doc || doc.deletedAt) return json({ error: 'That file is no longer stored.' }, { status: 404 });

  const blob = await readBlob(doc.pathname);
  if (!blob) return json({ error: 'That file is no longer stored.' }, { status: 404 });

  return new Response(blob.stream, {
    headers: {
      'Content-Type': blob.contentType || doc.contentType,
      'Content-Length': String(blob.size),
      // Never let a shared cache hold somebody's driver's licence.
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      // These are user uploads; do not let a crafted file execute in our origin.
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
