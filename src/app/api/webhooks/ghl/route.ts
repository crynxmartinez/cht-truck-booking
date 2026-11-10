import { MessageChannel } from '@prisma/client';
import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { json } from '@/lib/http';
import { logEvent, notifyStaff } from '@/lib/notify';
import { INBOUND_TEMPLATE, inboundKey, parseInbound, pickBooking, wantsReschedule } from '@/lib/inbound';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Replies from renters, sent here by GoHighLevel.
 *
 * Every reply is saved on the booking it belongs to, so it shows in that booking's
 * conversation and lights up the card until someone opens it. A reply that asks to
 * RESCHEDULE or CANCEL also badges the booking for review; nothing here ever
 * cancels or moves a date on its own.
 *
 * Point a GHL workflow ("Customer Replied" -> Webhook) at:
 *   POST {APP_URL}/api/webhooks/ghl?key={GHL_WEBHOOK_KEY}
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get('key') ?? req.headers.get('x-webhook-key');
  if (!config.ghl.webhookKey || key !== config.ghl.webhookKey) {
    return json({ error: 'Unauthorised' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad payload' }, { status: 400 });
  }

  const reply = parseInbound(body);
  if (!reply) return json({ ok: true, ignored: 'nothing to store' });

  const identifiers = [
    ...(reply.contactId ? [{ ghlContactId: reply.contactId }] : []),
    ...(reply.email ? [{ email: reply.email }] : []),
    ...(reply.phone ? [{ phone: reply.phone }] : []),
  ];
  if (identifiers.length === 0) return json({ ok: true, ignored: 'no way to tell who sent it' });

  const booking = pickBooking(
    await prisma.booking.findMany({
      where: { OR: identifiers },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, reference: true, stage: true, createdAt: true, rescheduleAsked: true },
    }),
  );
  if (!booking) return json({ ok: true, ignored: 'no matching booking' });

  // Stored once per reply: GoHighLevel retries land on the same key.
  try {
    await prisma.messageLog.create({
      data: {
        bookingId: booking.id,
        template: INBOUND_TEMPLATE,
        channel: reply.channel === 'EMAIL' ? MessageChannel.EMAIL : MessageChannel.SMS,
        status: 'SENT',
        recipientKey: inboundKey(reply),
        subject: reply.subject,
        body: reply.message,
        providerId: reply.messageId,
        providerContactId: reply.contactId || null,
        sentAt: reply.at,
      },
    });
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') return json({ ok: true, duplicate: true, reference: booking.reference });
    throw err;
  }

  const inPlay = booking.stage !== 'COMPLETED' && booking.stage !== 'CANCELLED';
  if (inPlay && wantsReschedule(reply.message) && !booking.rescheduleAsked) {
    await prisma.booking.update({ where: { id: booking.id }, data: { rescheduleAsked: true, needsReview: true } });
    await logEvent(booking.id, 'reschedule_requested', reply.message.slice(0, 500), 'renter');
    await notifyStaff(booking.id, 'reschedule_requested', { detail: reply.message.slice(0, 200) });
    return json({ ok: true, stored: true, flagged: 'reschedule', reference: booking.reference });
  }

  return json({ ok: true, stored: true, reference: booking.reference });
}
