import { MessageChannel, MessageStatus } from '@prisma/client';
import { prisma } from './db';
import { config } from './config';
import { dateToIso, hourInOps, todayInOps } from './dates';
import { logEvent, notify, setStage } from './notify';
import {
  nextPickupMessage,
  type Clock,
  type PickupSchedule,
  type PickupTemplate,
} from './pickup-schedule';

/**
 * The database half of the pickup-day messages: gather what has been sent,
 * ask the schedule what is due, send it. The rules live in pickup-schedule.ts
 * where they can be tested; this only moves data in and out.
 *
 * Called from the hourly cron for every booking picking up today, and straight
 * from approval — a renter approved at 10 AM must not wait for a job that only
 * ever looked at 6.
 */

const PICKUP_TEMPLATES: PickupTemplate[] = ['pickup_morning', 'pickup_reminder', 'pickup_no_show_check'];

/** A previous attempt that did not reach the renter and may be tried again. */
export type RetryableAttempt = { id: string; channel: MessageChannel };

export type PickupDecision = {
  template: PickupTemplate | null;
  /** Channels of this template that failed before; empty for a first send. */
  retry: RetryableAttempt[];
};

export function scheduleFromConfig(): PickupSchedule {
  return {
    morningHour: config.pickupSmsHour,
    reminderHour: config.pickupReminderHour,
    finalHour: config.noPickupCheckHour,
    lastHour: config.pickupLastHour,
    minGapHours: 3,
  };
}

export function yardClock(now: Date = new Date()): Clock {
  return { today: todayInOps(now), hour: hourInOps(now), now };
}

/**
 * Decide which pickup message is due for this booking, without sending it.
 * Read-only, so it can be pointed at a live booking to see what would happen.
 */
export async function duePickupMessage(
  bookingId: string,
  clock: Clock = yardClock(),
): Promise<PickupDecision> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      stage: true,
      pickupDate: true,
      checklists: { where: { phase: 'PICKUP' }, select: { submittedAt: true } },
      messages: {
        where: { recipientKey: 'renter', template: { in: PICKUP_TEMPLATES } },
        select: { id: true, template: true, channel: true, status: true, sentAt: true, createdAt: true },
      },
    },
  });
  if (!booking) return { template: null, retry: [] };

  // A template counts as delivered only when EVERY channel went out. Email
  // arriving while the text failed is not a renter who has their code, and a
  // failed row must never end the sequence — one GoHighLevel hiccup at 6 AM
  // would otherwise mean nobody ever retried.
  const byTemplate = new Map<string, typeof booking.messages>();
  for (const m of booking.messages) byTemplate.set(m.template, [...(byTemplate.get(m.template) ?? []), m]);

  const sent: Partial<Record<PickupTemplate, Date>> = {};
  for (const [template, rows] of byTemplate) {
    if (!rows.every((r) => r.status === MessageStatus.SENT)) continue;
    const finished = rows.map((r) => (r.sentAt ?? r.createdAt).getTime());
    sent[template as PickupTemplate] = new Date(Math.max(...finished));
  }

  const template = nextPickupMessage(
    {
      stage: booking.stage,
      pickupDate: dateToIso(booking.pickupDate),
      pickupSubmitted: booking.checklists.some((c) => c.submittedAt),
      sent,
    },
    clock,
    scheduleFromConfig(),
  );
  if (!template) return { template: null, retry: [] };

  const rows = byTemplate.get(template) ?? [];
  if (rows.length === 0) return { template, retry: [] }; // first attempt

  // Only a row that definitively did not go out is retried. One still QUEUED
  // belongs to a send in progress somewhere else, and resending it is exactly
  // how someone gets the same text twice.
  const retry = rows
    .filter((r) => r.status === MessageStatus.FAILED || r.status === MessageStatus.SKIPPED)
    .map((r) => ({ id: r.id, channel: r.channel }));
  return retry.length > 0 ? { template, retry } : { template: null, retry: [] };
}

/** Send whichever pickup message is due for this booking, if any. */
export async function sendDuePickupMessage(
  bookingId: string,
  clock: Clock = yardClock(),
): Promise<PickupTemplate | null> {
  const { template, retry } = await duePickupMessage(bookingId, clock);
  if (!template) return null;

  let channels: MessageChannel[] | undefined;
  if (retry.length > 0) {
    // Compare-and-set. Two callers can reach this point together — the approval
    // click and the hourly cron — and only the one that flips the row from
    // failed back to queued gets to resend it. The unique index already stops
    // a second *first* send; this is what stops a second *retry*.
    const won: MessageChannel[] = [];
    for (const attempt of retry) {
      const { count } = await prisma.messageLog.updateMany({
        where: { id: attempt.id, status: { in: [MessageStatus.FAILED, MessageStatus.SKIPPED] } },
        data: { status: MessageStatus.QUEUED, error: null },
      });
      if (count === 1) won.push(attempt.channel);
    }
    if (won.length === 0) return null;
    channels = won;
  }

  const res = await notify(bookingId, template, { force: retry.length > 0, channels });

  if (template === 'pickup_morning') {
    // Advance unless the send genuinely failed. "Skipped" with no error (GHL
    // not configured, or we lost a race to a sibling that is sending it) is not
    // a failure: advancing is what stops the hourly job re-offering it forever.
    if (res.sent.length > 0 || res.errors.length === 0) {
      await setStage(bookingId, 'PICKUP_DAY', 'system', 'Pickup day — lockbox code sent');
    } else {
      await logEvent(bookingId, 'pickup_code_failed', res.errors.join('; '), 'system');
    }
  }
  return template;
}
