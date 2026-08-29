import { prisma } from '@/lib/db';
import { json } from '@/lib/http';
import { readBlob } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/files/contract/<contractToken>
 *
 * The renter's own copy of what they signed. The contract token is the
 * credential — it is the same unguessable string we texted them, and it is
 * already the thing that let them sign in the first place, so it grants no
 * access they did not already have.
 *
 * Deliberately not expiring: people come back to this link months later, and a
 * dead link to your own signed agreement is a support call.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const contract = await prisma.contract.findUnique({
    where: { token },
    select: { pdfPathname: true, status: true, booking: { select: { reference: true } } },
  });

  if (!contract || !contract.pdfPathname) {
    return json({ error: 'There is no signed copy for this agreement yet.' }, { status: 404 });
  }

  const blob = await readBlob(contract.pdfPathname);
  if (!blob) return json({ error: 'That file is no longer stored.' }, { status: 404 });

  const filename = `CHT-rental-agreement-${contract.booking.reference}.pdf`;

  return new Response(blob.stream, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(blob.size),
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'private, max-age=600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
