import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { json } from '@/lib/http';
import { logEvent, notifyStaff } from '@/lib/notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Inbound SMS from GoHighLevel.
 *
 * The confirmation message invites people to "Reply RESCHEDULE", so something
 * has to be listening. This badges the booking and leaves the decision to the
 * office — it never cancels or moves a date on its own.
 *
 * Point a GHL workflow ("Customer Replied" → Webhook) at:
 *   POST {APP_URL}/api/webhooks/ghl?key={GHL_WEBHOOK_KEY}
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get('key') ?? req.headers.get('x-webhook-key');
  if (!config.ghl.webhookKey || key !== config.ghl.webhookKey) {
    return json({ error: 'Unauthorised' }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad payload' }, { status: 400 });
  }

  // GHL payload shapes vary by workflow; accept the common spellings.
  const contactId = String(body.contactId ?? body.contact_id ?? body.contact?.id ?? '');
  const phone = String(body.phone ?? body.contact?.phone ?? '');
  const email = String(body.email ?? body.contact?.email ?? '').toLowerCase();
  const message = String(body.message ?? body.body ?? body.messageBody ?? '').trim();

  if (!message) return json({ ok: true, ignored: 'no message body' });

  // Find the most recent live booking for whoever sent this.
  const booking = await prisma.booking.findFirst({
    where: {
      stage: { notIn: ['COMPLETED', 'CANCELLED'] },
      OR: [
        ...(contactId ? [{ ghlContactId: contactId }] : []),
        ...(email ? [{ email }] : []),
        ...(phone ? [{ phone }] : []),
      ],
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, reference: true, rescheduleAsked: true },
  });

  if (!booking) return json({ ok: true, ignored: 'no matching booking' });

  const normalised = message.toUpperCase();
  const wantsReschedule = /\bRESCHEDULE\b/.test(normalised) || /\bCANCEL\b/.test(normalised);

  if (wantsReschedule && !booking.rescheduleAsked) {
    await prisma.booking.update({ where: { id: booking.id }, data: { rescheduleAsked: true, needsReview: true } });
    await logEvent(booking.id, 'reschedule_requested', message.slice(0, 500), 'renter');
    await notifyStaff(booking.id, 'reschedule_requested', { detail: message.slice(0, 200) });
    return json({ ok: true, flagged: 'reschedule', reference: booking.reference });
  }

  await logEvent(booking.id, 'inbound_message', message.slice(0, 500), 'renter');
  return json({ ok: true, logged: true, reference: booking.reference });
}
