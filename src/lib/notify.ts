import { MessageChannel, MessageStatus, Stage } from '@prisma/client';
import { prisma } from './db';
import { config } from './config';
import { dateToIso, rentalDaysBetween, todayInOps } from './dates';
import { render, toHtml, toPlain, type MessageContext, type TemplateKey } from './messages';
import { isUrgent, renderStaff, type StaffContext, type StaffEvent } from './staff-messages';
import { findContactByEmail, sendEmail, sendSms, upsertContact } from './ghl';
import { loadSettings } from './settings';

/**
 * The only way anything leaves this system.
 *
 * Idempotency lives in the database: MessageLog has a unique index on
 * (bookingId, template, channel). We claim the row *before* calling GHL, so a
 * cron that runs twice, or a retry after a timeout, collides on the insert and
 * quietly does nothing rather than texting somebody at 6 AM twice.
 */

export type NotifyOptions = {
  channels?: MessageChannel[];
  /** Send even if this template already went out — used by "resend" in the CRM. */
  force?: boolean;
  /** Override the recipient, for the additional driver who is not the renter. */
  to?: { firstName: string; lastName: string; email: string; phone: string };
};

type BookingForNotify = {
  id: string;
  reference: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  pickupDate: Date;
  returnDate: Date;
  ghlContactId: string | null;
  truck: { code: string; lockboxCode: string } | null;
};

export async function buildContext(bookingId: string): Promise<{ booking: BookingForNotify; ctx: MessageContext } | null> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      reference: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      pickupDate: true,
      returnDate: true,
      ghlContactId: true,
      truck: { select: { code: true, lockboxCode: true } },
      contracts: { select: { token: true, type: true, status: true }, orderBy: { createdAt: 'desc' } },
      checklists: { select: { token: true, phase: true } },
      additionalDriver: { select: { name: true } },
    },
  });
  if (!booking) return null;

  const rental = booking.contracts.find((c) => c.type === 'RENTAL_AGREEMENT');
  const addDrv = booking.contracts.find((c) => c.type === 'ADDITIONAL_DRIVER');
  const pickList = booking.checklists.find((c) => c.phase === 'PICKUP');
  const dropList = booking.checklists.find((c) => c.phase === 'DROPOFF');

  const ctx: MessageContext = {
    firstName: booking.firstName,
    lastName: booking.lastName,
    reference: booking.reference,
    truckCode: booking.truck?.code ?? null,
    pickupDate: dateToIso(booking.pickupDate),
    returnDate: dateToIso(booking.returnDate),
    lockboxCode: booking.truck?.lockboxCode ?? null,
    contractToken: rental?.token ?? null,
    pickupChecklistToken: pickList?.token ?? null,
    dropoffChecklistToken: dropList?.token ?? null,
    additionalDriverName: booking.additionalDriver?.name ?? null,
    agreementSigned: rental?.status === 'SIGNED',
    pickupIsToday: dateToIso(booking.pickupDate) === todayInOps(),
    rentalDays: rentalDaysBetween(dateToIso(booking.pickupDate), dateToIso(booking.returnDate)),
    renterName: `${booking.firstName} ${booking.lastName}`.trim(),
  };

  // The additional-driver message links to its own contract, not the rental one.
  if (addDrv) ctx.contractToken = addDrv.token;

  return { booking: booking as unknown as BookingForNotify, ctx };
}

/** Make sure we have a GHL contact id, upserting on first use. */
async function ensureContact(
  bookingId: string,
  person: { firstName: string; lastName: string; email: string; phone: string },
  existingId: string | null,
  isRenter: boolean,
): Promise<{ contactId: string } | { error: string }> {
  if (existingId && isRenter) return { contactId: existingId };

  const res = await upsertContact({
    firstName: person.firstName,
    lastName: person.lastName,
    email: person.email,
    phone: person.phone,
    tags: ['truck-rental'],
  });
  if (!res.ok) return { error: res.error };

  if (isRenter) {
    await prisma.booking.update({ where: { id: bookingId }, data: { ghlContactId: res.data.contactId } });
  }
  return { contactId: res.data.contactId };
}

type Body = { subject: string; email: string; sms: string };
type Recipient = { firstName: string; lastName: string; email: string; phone: string };

/**
 * The one place a message actually leaves the building.
 *
 * The MessageLog row is claimed *before* the provider is called, and the unique
 * index on (bookingId, template, channel) is what makes that a lock: a retried
 * cron collides on the insert and quietly does nothing rather than sending
 * twice. Customer and staff messages share this so neither can drift.
 */
async function dispatch(opts: {
  bookingId: string;
  template: string;
  channels: MessageChannel[];
  recipient: Recipient;
  body: Body;
  force?: boolean;
  /** "renter" for customer messages, otherwise the recipient id. */
  recipientKey?: string;
  recipientId?: string | null;
  resolveContact: () => Promise<{ contactId: string } | { error: string }>;
}): Promise<{ sent: MessageChannel[]; skipped: MessageChannel[]; errors: string[] }> {
  const { bookingId, template, channels, recipient, body, force } = opts;
  const recipientKey = opts.recipientKey ?? 'renter';
  const recipientId = opts.recipientId ?? null;
  const sent: MessageChannel[] = [];
  const skipped: MessageChannel[] = [];
  const errors: string[] = [];

  // Resolved lazily and once, so a run that skips every channel never touches GHL.
  let contactPromise: Promise<{ contactId: string } | { error: string }> | null = null;

  for (const channel of channels) {
    const payload = {
      toAddress: channel === MessageChannel.EMAIL ? recipient.email : recipient.phone,
      subject: channel === MessageChannel.EMAIL ? body.subject : null,
      body: channel === MessageChannel.EMAIL ? toPlain(body.email) : body.sms,
    };

    let logId: string;
    try {
      const log = await prisma.messageLog.create({
        data: { bookingId, template, channel, recipientKey, recipientId, status: MessageStatus.QUEUED, ...payload },
      });
      logId = log.id;
    } catch {
      if (!force) {
        skipped.push(channel);
        continue;
      }
      const existing = await prisma.messageLog.findUnique({
        where: { bookingId_template_channel_recipientKey: { bookingId, template, channel, recipientKey } },
      });
      if (!existing) {
        skipped.push(channel);
        continue;
      }
      logId = existing.id;
      await prisma.messageLog.update({
        where: { id: logId },
        data: { status: MessageStatus.QUEUED, error: null, ...payload },
      });
    }

    if (!config.ghl.enabled) {
      await prisma.messageLog.update({
        where: { id: logId },
        data: { status: MessageStatus.SKIPPED, error: 'GoHighLevel not configured.' },
      });
      skipped.push(channel);
      continue;
    }

    contactPromise ??= opts.resolveContact();
    const contact = await contactPromise;
    if ('error' in contact) {
      await prisma.messageLog.update({
        where: { id: logId },
        data: { status: MessageStatus.FAILED, error: contact.error },
      });
      errors.push(`${channel}: ${contact.error}`);
      continue;
    }

    const res =
      channel === MessageChannel.EMAIL
        ? await sendEmail(contact.contactId, body.subject, { text: toPlain(body.email), html: toHtml(body.email) })
        : await sendSms(contact.contactId, body.sms);

    if (res.ok) {
      await prisma.messageLog.update({
        where: { id: logId },
        data: {
          status: MessageStatus.SENT,
          sentAt: new Date(),
          providerId: res.data.messageId ?? null,
          providerContactId: contact.contactId,
        },
      });
      sent.push(channel);
    } else {
      await prisma.messageLog.update({
        where: { id: logId },
        data: { status: MessageStatus.FAILED, error: res.error, providerContactId: contact.contactId },
      });
      errors.push(`${channel}: ${res.error}`);
    }
  }

  return { sent, skipped, errors };
}

export async function notify(
  bookingId: string,
  template: TemplateKey,
  options: NotifyOptions = {},
): Promise<{ sent: MessageChannel[]; skipped: MessageChannel[]; errors: string[] }> {
  // Whatever started this, the message is worded from what the office last saved:
  // a cold server would otherwise send the built-in text over their edit.
  await loadSettings();
  const built = await buildContext(bookingId);
  if (!built) return { sent: [], skipped: [], errors: ['Booking not found.'] };

  const { booking, ctx } = built;
  const recipient = options.to ?? {
    firstName: booking.firstName,
    lastName: booking.lastName,
    email: booking.email,
    phone: booking.phone,
  };
  const isRenter = !options.to;

  return dispatch({
    bookingId,
    template,
    channels: options.channels ?? [MessageChannel.EMAIL, MessageChannel.SMS],
    recipient,
    force: options.force,
    body: render(template, options.to ? { ...ctx, firstName: recipient.firstName } : ctx),
    resolveContact: () => ensureContact(bookingId, recipient, booking.ghlContactId, isRenter),
  });
}


/**
 * A message the office wrote by hand. Sent through the same dispatch as every
 * other message, so it is logged with its exact text and recipient and shows
 * on the booking. Each one gets its own key, so sending a second never
 * collides with the first.
 */
export async function sendCustomMessage(
  bookingId: string,
  input: { subject: string; text: string; channels: MessageChannel[] },
): Promise<{ sent: MessageChannel[]; skipped: MessageChannel[]; errors: string[] }> {
  const built = await buildContext(bookingId);
  if (!built) return { sent: [], skipped: [], errors: ['Booking not found.'] };

  const { booking } = built;
  const recipient = {
    firstName: booking.firstName,
    lastName: booking.lastName,
    email: booking.email,
    phone: booking.phone,
  };

  return dispatch({
    bookingId,
    template: 'office_message',
    channels: input.channels,
    recipient,
    recipientKey: `office-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    body: { subject: input.subject, email: input.text, sms: input.text },
    resolveContact: () => ensureContact(bookingId, recipient, booking.ghlContactId, true),
  });
}

// ---------------------------------------------------------------- staff

/**
 * Resolve a recipient's GHL contact, caching the id on their row.
 *
 * Looks up by email and only creates when nobody matches — an upsert would
 * overwrite whatever the office named the contact, which is how "Diana For
 * Truck automation" once silently became "Diana Alsup".
 */
async function recipientContactId(r: {
  id: string; name: string; email: string; phone: string; ghlContactId: string | null;
}): Promise<{ contactId: string } | { error: string }> {
  if (r.ghlContactId) return { contactId: r.ghlContactId };

  const found = await findContactByEmail(r.email);
  let contactId: string | null = found.ok ? found.data.contactId : null;

  if (!contactId) {
    const [firstName, ...rest] = r.name.split(' ');
    const res = await upsertContact({
      firstName: firstName || 'Office',
      lastName: rest.join(' '),
      email: r.email,
      phone: r.phone,
      tags: ['truck-ops-staff'],
    });
    if (!res.ok) return { error: res.error };
    contactId = res.data.contactId;
  }

  await prisma.notificationRecipient
    .update({ where: { id: r.id }, data: { ghlContactId: contactId } })
    .catch(() => undefined);

  return { contactId };
}

/** Everyone currently on the notification list. */
export async function activeRecipients() {
  return prisma.notificationRecipient.findMany({
    where: { active: true },
    orderBy: [{ role: 'asc' }, { name: 'asc' }],
  });
}

/** Everyone who can sign. Empty if nobody is set, which the CRM warns about. */
export async function mainAdmins() {
  return prisma.notificationRecipient.findMany({
    where: { role: 'MAIN_ADMIN', active: true },
    orderBy: { name: 'asc' },
  });
}

/**
 * Tell the office a rental moved.
 *
 * Fans out to every active recipient, each with their own MessageLog rows, so
 * one person's failure never suppresses another's copy. Never throws: an alert
 * failing must not roll back the thing it was reporting on.
 */
export async function notifyStaff(
  bookingId: string,
  event: StaffEvent,
  extra: Partial<StaffContext> = {},
  // Staff rows are deduplicated per booking and event, so a second legitimate
  // truck swap or reschedule would otherwise be silently dropped. Forcing
  // resends it, the same way the renter's copy already does.
  options: { force?: boolean } = {},
): Promise<void> {
  if (!config.staff.notifyEnabled) return;

  try {
    const people = await activeRecipients();
    if (!people.length) {
      console.warn('[staff] nobody on the notification list — alert dropped:', event);
      return;
    }

    const b = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        reference: true, firstName: true, lastName: true, email: true, phone: true,
        pickupDate: true, returnDate: true,
        truck: { select: { code: true } },
        additionalDriver: { select: { name: true } },
      },
    });
    if (!b) return;

    const ctx: StaffContext = {
      reference: b.reference,
      renterName: `${b.firstName} ${b.lastName}`.trim(),
      renterEmail: b.email,
      renterPhone: b.phone,
      truckCode: b.truck?.code ?? null,
      pickupDate: dateToIso(b.pickupDate),
      returnDate: dateToIso(b.returnDate),
      additionalDriverName: b.additionalDriver?.name ?? null,
      ...extra,
    };
    const body = renderStaff(event, ctx);

    for (const p of people) {
      // Routine progress can be email-only per person; anything needing action
      // today still texts, whatever that preference says.
      const channels: MessageChannel[] = [];
      if (p.notifyEmail) channels.push(MessageChannel.EMAIL);
      if (p.notifySms || isUrgent(event)) channels.push(MessageChannel.SMS);
      if (!channels.length) continue;

      await dispatch({
        bookingId,
        template: `staff_${event}`,
        channels,
        recipientKey: p.id,
        recipientId: p.id,
        recipient: {
          firstName: p.name.split(' ')[0] ?? 'Office',
          lastName: p.name.split(' ').slice(1).join(' '),
          email: p.email,
          phone: p.phone,
        },
        body,
        force: options.force,
        resolveContact: () => recipientContactId(p),
      });
    }
  } catch (err) {
    console.error('staff notify failed', event, err);
  }
}

/** Append to the booking's activity log. Never throws — logging must not break a flow. */
export async function logEvent(
  bookingId: string,
  type: string,
  detail?: string,
  actor: string = 'system',
  meta?: Record<string, unknown>,
) {
  try {
    await prisma.bookingEvent.create({
      data: { bookingId, type, detail: detail ?? null, actor, meta: (meta ?? undefined) as never },
    });
  } catch {
    /* activity log is best-effort */
  }
}

/** Move a booking to a new stage and record it. */
export async function setStage(bookingId: string, stage: Stage, actor = 'system', detail?: string) {
  const current = await prisma.booking.findUnique({ where: { id: bookingId }, select: { stage: true } });
  if (!current || current.stage === stage) return current?.stage ?? null;

  await prisma.booking.update({ where: { id: bookingId }, data: { stage } });
  await logEvent(bookingId, 'stage_change', detail ?? `${current.stage} → ${stage}`, actor, {
    from: current.stage,
    to: stage,
  });
  return stage;
}

/**
 * An alert about the system rather than a booking, such as storage filling up.
 *
 * Goes to everyone on the notification list, by email, plus a text to anyone
 * who has texts on when `urgent`. MessageLog hangs off a booking, so these
 * are not logged per message; the caller records that it alerted, so it does
 * not repeat itself. Never throws.
 */
export async function notifyOffice(
  subject: string,
  text: string,
  options: { urgent?: boolean; sms?: string } = {},
): Promise<{ sent: number; failed: number }> {
  const result = { sent: 0, failed: 0 };
  if (!config.staff.notifyEnabled || !config.ghl.enabled) return result;

  try {
    const people = await activeRecipients();
    for (const p of people) {
      const contact = await recipientContactId(p);
      if ('error' in contact) {
        result.failed += 1;
        continue;
      }
      if (p.notifyEmail) {
        const res = await sendEmail(contact.contactId, subject, { text, html: toHtml(text) });
        if (res.ok) result.sent += 1;
        else result.failed += 1;
      }
      if (options.sms && (p.notifySms || options.urgent)) {
        const res = await sendSms(contact.contactId, options.sms);
        if (res.ok) result.sent += 1;
        else result.failed += 1;
      }
    }
  } catch (err) {
    console.error('office alert failed', subject, err);
    result.failed += 1;
  }
  return result;
}
