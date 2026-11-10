import { INBOUND_TEMPLATE } from './inbound';
import { toPlain } from './messages';

/**
 * One booking's conversation with its renter: what we sent (automatic messages
 * and the office's own) and what they replied, in time order. Pure.
 *
 * Staff alerts are logged in the same table under the staff member's id, so they
 * are left out: this is the renter's thread, not the office's inbox.
 */

export type ThreadRow = {
  id: string;
  template: string;
  channel: string;
  status: string;
  recipientKey: string;
  toAddress: string | null;
  subject: string | null;
  body: string | null;
  error: string | null;
  sentAt: Date | null;
  createdAt: Date;
};

/** Replies saved by an older version, as activity-log entries. */
export type LegacyReply = { id: string; detail: string | null; createdAt: Date };

export type ThreadItem = {
  id: string;
  dir: 'in' | 'out';
  /** ISO time, so the screen can group by day and sort. */
  at: string;
  channel: 'SMS' | 'EMAIL';
  from: 'renter' | 'office' | 'auto';
  label: string;
  subject: string | null;
  text: string;
  failed: boolean;
  error: string | null;
  to: string | null;
};

const LABELS: Record<string, string> = {
  booking_received: 'Booking received',
  contract_to_sign: 'Agreement to sign',
  contract_nudge: 'Signing reminder',
  additional_driver: 'Additional driver',
  truck_changed: 'Truck changed',
  dates_changed: 'Dates changed',
  rental_confirmed: 'Confirmation',
  pickup_morning: 'Pickup and lockbox code',
  pickup_reminder: 'Pickup reminder',
  pickup_no_show_check: 'Pickup check',
  return_day: 'Return reminder',
  overdue: 'Overdue notice',
  booking_cancelled: 'Cancelled',
  booking_released: 'Truck released',
  thank_you: 'Thank you',
  office_message: 'You',
};

export function labelFor(template: string): string {
  return LABELS[template] ?? template.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/** A message in the renter's thread: to or from the renter, never a staff alert. */
export const inThread = (r: Pick<ThreadRow, 'recipientKey'>) =>
  r.recipientKey === 'renter' || r.recipientKey.startsWith('office-') || r.recipientKey.startsWith('in:');

export function buildThread(rows: ThreadRow[], legacy: LegacyReply[] = []): ThreadItem[] {
  const items: ThreadItem[] = [];

  for (const r of rows) {
    if (!inThread(r) || r.status === 'SKIPPED' || r.status === 'QUEUED') continue;
    const inbound = r.template === INBOUND_TEMPLATE;
    const channel = r.channel === 'EMAIL' ? 'EMAIL' : 'SMS';
    items.push({
      id: r.id,
      dir: inbound ? 'in' : 'out',
      at: (r.sentAt ?? r.createdAt).toISOString(),
      channel,
      from: inbound ? 'renter' : r.template === 'office_message' ? 'office' : 'auto',
      label: inbound ? 'Reply' : labelFor(r.template),
      subject: r.subject,
      // Our own emails carry [[Button|link]] markup; read it as plain words.
      text: r.body === null || r.body === '' ? 'The text of this message was not saved.' : inbound ? r.body : toPlain(r.body),
      failed: r.status === 'FAILED',
      error: r.error,
      to: inbound ? null : r.toAddress,
    });
  }

  for (const e of legacy) {
    if (!e.detail) continue;
    items.push({
      id: `ev-${e.id}`, dir: 'in', at: e.createdAt.toISOString(), channel: 'SMS', from: 'renter', label: 'Reply',
      subject: null, text: e.detail, failed: false, error: null, to: null,
    });
  }

  return items.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

/**
 * Replies that arrived after the conversation was last read. Judged by when each reply reached us,
 * not by the time in its payload, so a late-delivered reply still counts as new.
 */
export function countUnread(rows: ThreadRow[], lastReadAt: Date | null): number {
  const since = lastReadAt?.getTime() ?? 0;
  return rows.filter((r) => inThread(r) && r.template === INBOUND_TEMPLATE && r.createdAt.getTime() > since).length;
}

/**
 * Which bookings have a reply nobody has read: the newest reply is later than the
 * last time someone opened the conversation (or it was never opened).
 */
export function unreadBookingIds(newestReply: Map<string, Date>, lastRead: Map<string, Date>): Set<string> {
  const out = new Set<string>();
  for (const [id, replied] of newestReply) {
    const read = lastRead.get(id);
    if (!read || replied.getTime() > read.getTime()) out.add(id);
  }
  return out;
}
