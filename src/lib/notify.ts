import { MessageChannel, MessageStatus, Stage } from '@prisma/client';
import { prisma } from './db';
import { config } from './config';
import { dateToIso } from './dates';
import { render, toHtml, type MessageContext, type TemplateKey } from './messages';
import { isUrgent, renderStaff, type StaffContext, type StaffEvent } from './staff-messages';
import { sendEmail, sendSms, upsertContact } from './ghl';

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
  resolveContact: () => Promise<{ contactId: string } | { error: string }>;
}): Promise<{ sent: MessageChannel[]; skipped: MessageChannel[]; errors: string[] }> {
  const { bookingId, template, channels, recipient, body, force } = opts;
  const sent: MessageChannel[] = [];
  const skipped: MessageChannel[] = [];
  const errors: string[] = [];

  // Resolved lazily and once, so a run that skips every channel never touches GHL.
  let contactPromise: Promise<{ contactId: string } | { error: string }> | null = null;

  for (const channel of channels) {
    const payload = {
      toAddress: channel === MessageChannel.EMAIL ? recipient.email : recipient.phone,
      subject: channel === MessageChannel.EMAIL ? body.subject : null,
      body: channel === MessageChannel.EMAIL ? body.email : body.sms,
    };

    let logId: string;
    try {
      const log = await prisma.messageLog.create({
        data: { bookingId, template, channel, status: MessageStatus.QUEUED, ...payload },
      });
      logId = log.id;
    } catch {
      if (!force) {
        skipped.push(channel);
        continue;
      }
      const existing = await prisma.messageLog.findUnique({
        where: { bookingId_template_channel: { bookingId, template, channel } },
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
        ? await sendEmail(contact.contactId, body.subject, { text: body.email, html: toHtml(body.email) })
        : await sendSms(contact.contactId, body.sms);

    if (res.ok) {
      await prisma.messageLog.update({
        where: { id: logId },
        data: { status: MessageStatus.SENT, sentAt: new Date(), providerId: res.data.messageId ?? null },
      });
      sent.push(channel);
    } else {
      await prisma.messageLog.update({
        where: { id: logId },
        data: { status: MessageStatus.FAILED, error: res.error },
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


// ---------------------------------------------------------------- staff

const STAFF_CONTACT_KEY = 'ghl.staff.contactId';

/**
 * Diana's GHL contact id, cached in Settings.
 *
 * Without this every alert would upsert her again — five extra API calls per
 * rental for a contact that never changes.
 */
async function staffContactId(): Promise<{ contactId: string } | { error: string }> {
  const cached = await prisma.setting.findUnique({ where: { key: STAFF_CONTACT_KEY } });
  if (cached?.value) return { contactId: cached.value };

  const [firstName, ...rest] = config.staff.name.split(' ');
  const res = await upsertContact({
    firstName: firstName || 'Office',
    lastName: rest.join(' '),
    email: config.staff.email,
    phone: config.staff.phone,
    tags: ['truck-ops-staff'],
  });
  if (!res.ok) return { error: res.error };

  await prisma.setting
    .upsert({
      where: { key: STAFF_CONTACT_KEY },
      create: { key: STAFF_CONTACT_KEY, value: res.data.contactId },
      update: { value: res.data.contactId },
    })
    .catch(() => undefined);

  return { contactId: res.data.contactId };
}

/**
 * Tell the office a rental moved.
 *
 * Never throws and never blocks: an alert failing must not roll back the thing
 * it was reporting on. Failures land in MessageLog like any other send, so the
 * booking card shows them.
 */
export async function notifyStaff(
  bookingId: string,
  event: StaffEvent,
  extra: Partial<StaffContext> = {},
): Promise<void> {
  if (!config.staff.configured) return;

  try {
    const b = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        reference: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        pickupDate: true,
        returnDate: true,
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

    // Routine progress can be email-only if the texts get noisy; anything that
    // needs acting on today always texts, whatever that setting says.
    const wantsSms = config.staff.smsEnabled || isUrgent(event);
    const channels = wantsSms
      ? [MessageChannel.EMAIL, MessageChannel.SMS]
      : [MessageChannel.EMAIL];

    await dispatch({
      bookingId,
      // Namespaced so a staff alert can never collide with the customer
      // template of the same name in the idempotency index.
      template: `staff_${event}`,
      channels,
      recipient: {
        firstName: config.staff.name.split(' ')[0] ?? 'Office',
        lastName: config.staff.name.split(' ').slice(1).join(' '),
        email: config.staff.email,
        phone: config.staff.phone,
      },
      body: renderStaff(event, ctx),
      resolveContact: staffContactId,
    });
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
