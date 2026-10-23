import { createHash } from 'node:crypto';
import { prisma } from './db';
import { config } from './config';
import { dateToIso, eachDay, formatMedium, type IsoDate } from './dates';
import { deleteEvent, putEvent } from './gcal';
import { logEvent } from './notify';
import type { ExpectedEvent } from './invariants';

/**
 * Mirrors bookings onto the office's shared Google calendar.
 *
 * Deliberately matches the convention the office already had: one event per
 * day, 06:00–18:00, the renter's name in the title. A three-day rental is
 * three events, not one bar, because that is how the month view shows each day
 * as occupied.
 *
 * Nothing here throws. A calendar that is down, misconfigured or not yet set
 * up must never take a booking with it — the booking is the record, the
 * calendar is a convenience.
 */

/** Google's fixed palette. Chosen to match the CRM's own truck colours. */
const COLOR = { A: '9', B: '6' } as const; // Blueberry, Tangerine

const OPEN_HOUR = '06:00:00';
const CLOSE_HOUR = '18:00:00';

/**
 * A stable event id derived from the booking and the day.
 *
 * Google accepts caller-supplied ids from a base32hex alphabet, and hex is a
 * subset of it. Deriving the id means create, update and delete all address
 * the same row without us keeping a mapping table — and a retry cannot leave
 * a duplicate behind.
 */
export function eventId(bookingId: string, day: IsoDate): string {
  return 'cht' + createHash('sha256').update(`${bookingId}:${day}`).digest('hex').slice(0, 40);
}

export type BookingForCalendar = {
  id: string;
  reference: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  blockStart: Date;
  blockEnd: Date;
  stage: string;
  truck: { code: string } | null;
};

async function load(bookingId: string): Promise<BookingForCalendar | null> {
  return prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true, reference: true, firstName: true, lastName: true,
      email: true, phone: true, blockStart: true, blockEnd: true, stage: true,
      truck: { select: { code: true } },
    },
  });
}

const esc = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Stages where the truck is spoken for but nobody has signed yet. */
const UNCONFIRMED = new Set(['NEW_BOOKING', 'CONTRACT_SENT', 'ADDITIONAL_DRIVER', 'AWAITING_APPROVAL']);

function describe(b: BookingForCalendar): { summary: string; description: string } {
  const truck = b.truck?.code ?? '?';
  const name = `${b.firstName} ${b.lastName}`.trim();
  const held = UNCONFIRMED.has(b.stage);

  // Truck first: in a month view the title is truncated, and which truck it is
  // needs to survive that.
  const summary = `Truck ${truck} · ${name}${held ? ' (unconfirmed)' : ''}`;

  // Google Calendar renders a small subset of HTML in the description, so the
  // CRM link can be a word rather than a naked URL — worth it, because a
  // tokenised link wraps across three lines on a phone and reads as noise.
  const crm = `${config.appUrl}/app?ref=${encodeURIComponent(b.reference)}`;
  const description = [
    `<b>Truck ${truck} — ${esc(name)}</b>`,
    `${formatMedium(dateToIso(b.blockStart))} to ${formatMedium(dateToIso(b.blockEnd))}`,
    '',
    `Phone: <a href="tel:${esc(b.phone)}">${esc(b.phone)}</a>`,
    `Email: <a href="mailto:${esc(b.email)}">${esc(b.email)}</a>`,
    `Reference: ${esc(b.reference)}`,
    held ? 'Status: held, not yet confirmed' : 'Status: confirmed',
    '',
    `<a href="${esc(crm)}">Open this booking in the CRM</a>`,
  ].join('<br>');

  return { summary, description };
}

export type PlannedEvent = ExpectedEvent & { day: IsoDate };

/**
 * The one event per day this booking should have on the office calendar.
 *
 * Split out of the sync so the invariant checker asks the same question the
 * sync answers, and the two cannot drift: a dry run, a live write and a
 * read-back audit all agree on what "correct" means.
 */
export function expectedEventsFor(b: BookingForCalendar): PlannedEvent[] {
  const { summary } = describe(b);
  const colorId = COLOR[(b.truck?.code as 'A' | 'B') ?? 'A'] ?? COLOR.A;
  const status = UNCONFIRMED.has(b.stage) ? 'tentative' : 'confirmed';
  return eachDay(dateToIso(b.blockStart), dateToIso(b.blockEnd)).map((day) => ({
    id: eventId(b.id, day),
    day,
    summary,
    colorId,
    status,
  }));
}

/**
 * Put the booking on the calendar, creating or correcting one event per day.
 *
 * `previous` clears events from a range the booking no longer occupies, which
 * is what makes a date change a move rather than a duplicate.
 */
export async function syncBookingToCalendar(
  bookingId: string,
  previous?: { start: IsoDate; end: IsoDate },
): Promise<void> {
  if (!config.gcal.enabled) return;

  try {
    const b = await load(bookingId);
    if (!b) return;

    const start = dateToIso(b.blockStart);
    const end = dateToIso(b.blockEnd);
    const days = eachDay(start, end);
    const keep = new Set(days);

    // Days it used to cover and no longer does.
    if (previous) {
      for (const day of eachDay(previous.start, previous.end)) {
        if (!keep.has(day)) await deleteEvent(config.gcal.calendarId, eventId(bookingId, day));
      }
    }

    const { description } = describe(b);

    const failures: string[] = [];
    for (const planned of expectedEventsFor(b)) {
      const res = await putEvent(config.gcal.calendarId, {
        id: planned.id,
        summary: planned.summary,
        description,
        start: `${planned.day}T${OPEN_HOUR}`,
        end: `${planned.day}T${CLOSE_HOUR}`,
        timeZone: config.timeZone,
        colorId: planned.colorId,
        status: planned.status as 'tentative' | 'confirmed',
      });
      if (!res.ok) failures.push(`${planned.day}: ${res.error}`);
    }

    if (failures.length) {
      console.error('calendar sync failed', b.reference, failures);
      await logEvent(bookingId, 'calendar_failed', failures.slice(0, 3).join(' · '), 'system');
    }
  } catch (err) {
    // The booking is the record of truth; a calendar problem is never fatal.
    console.error('calendar sync threw', bookingId, err);
  }
}

/** Take the booking off the calendar — cancelled, or released unsigned. */
export async function removeBookingFromCalendar(
  bookingId: string,
  range?: { start: IsoDate; end: IsoDate },
): Promise<void> {
  if (!config.gcal.enabled) return;

  try {
    let span = range;
    if (!span) {
      const b = await load(bookingId);
      if (!b) return;
      span = { start: dateToIso(b.blockStart), end: dateToIso(b.blockEnd) };
    }
    for (const day of eachDay(span.start, span.end)) {
      await deleteEvent(config.gcal.calendarId, eventId(bookingId, day));
    }
  } catch (err) {
    console.error('calendar removal threw', bookingId, err);
  }
}
