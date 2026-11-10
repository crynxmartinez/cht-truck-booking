import { createHash } from 'node:crypto';
import { toE164 } from './http';

/**
 * A reply from a renter, as GoHighLevel's "Customer Replied" workflow sends it.
 * The payload shape varies by workflow, so the common spellings are all accepted.
 * Pure: it reads a payload and decides; it stores nothing.
 */

export const INBOUND_TEMPLATE = 'inbound_reply';
export const MAX_REPLY_LENGTH = 5000;

export type Inbound = {
  contactId: string;
  /** E.164, or '' when the payload had none. */
  phone: string;
  email: string;
  message: string;
  subject: string | null;
  channel: 'SMS' | 'EMAIL';
  messageId: string | null;
  at: Date;
  /** True when the time came from the payload itself, so a retry carries exactly the same one. */
  atFromPayload: boolean;
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const first = (...vs: unknown[]): string => vs.map(str).find((s) => s.trim() !== '') ?? '';

/** Reads the payload. Returns null when there is nothing to store: no text, or a message WE sent. */
export function parseInbound(body: unknown, now: Date = new Date()): Inbound | null {
  const b = obj(body);
  const contact = obj(b.contact);
  const message = obj(b.message);

  // A workflow that also fires for our own messages must not turn them into "replies".
  const direction = first(b.direction, message.direction).toLowerCase();
  if (direction === 'outbound') return null;

  const text = first(typeof b.message === 'string' ? b.message : '', message.body, b.body, b.messageBody, b.text)
    .replace(/\r\n?/g, '\n')
    .trim();
  if (!text) return null;

  const kind = first(b.type, b.messageType, b.channel, message.type, message.messageType).toLowerCase();
  const phoneRaw = first(b.phone, contact.phone);
  const dateRaw = first(b.dateAdded, b.date_added, b.timestamp, message.dateAdded);
  const when = dateRaw ? new Date(dateRaw) : null;

  return {
    contactId: first(b.contactId, b.contact_id, contact.id),
    phone: phoneRaw ? toE164(phoneRaw) : '',
    email: first(b.email, contact.email).trim().toLowerCase(),
    message: text.slice(0, MAX_REPLY_LENGTH),
    subject: first(b.subject, message.subject).trim().slice(0, 300) || null,
    channel: kind.includes('email') ? 'EMAIL' : 'SMS',
    // Only fields that are clearly the message's own. A bare top-level "id" can be the contact's, and
    // keying on it would make a renter's second reply look like a repeat of their first.
    messageId: first(b.messageId, b.message_id, message.id).trim().slice(0, 80) || null,
    // A date from the future (or nonsense) is not trusted: the reply is shown as arriving now.
    at: when && !Number.isNaN(when.getTime()) && when.getTime() <= now.getTime() + 5 * 60_000 ? when : now,
    atFromPayload: Boolean(when && !Number.isNaN(when.getTime()) && when.getTime() <= now.getTime() + 5 * 60_000),
  };
}

/**
 * The key that makes a reply store once, however many times GoHighLevel sends it. The message id
 * when there is one; otherwise who, what and the minute, so a retry lands on the same key.
 */
export function inboundKey(i: Inbound): string {
  const clean = i.messageId ? i.messageId.replace(/[^A-Za-z0-9_-]/g, '') : '';
  // An id with nothing usable left in it must not become the key "in:", which every such reply would share.
  if (clean) return `in:${clean}`;
  // No message id: who, what and when. The time in the payload when there is one (a retry carries the
  // same), otherwise the minute it reached us.
  const when = i.atFromPayload ? i.at.toISOString() : i.at.toISOString().slice(0, 16);
  const hash = createHash('sha1').update([i.contactId, i.phone, i.email, i.message, when].join('|')).digest('hex');
  return `in:h:${hash.slice(0, 24)}`;
}

/**
 * Is this message-log row part of the conversation with the renter? Staff alerts share the table, keyed by the
 * staff member's id; the renter's own messages are keyed "renter", the office's own "office-...", replies "in:...".
 */
export const isRenterThreadKey = (recipientKey: string): boolean =>
  recipientKey === 'renter' || recipientKey.startsWith('office-') || recipientKey.startsWith('in:');

export type BookingCandidate = { id: string; stage: string; createdAt: Date; ghlContactId?: string | null };

/**
 * Which booking a reply belongs to. When bookings share a phone number or email (a couple, or a
 * renter with two bookings), the GoHighLevel contact is the strongest sign of who wrote, so those
 * come first. Among them: the newest still in play, otherwise the newest of all, so a reply after
 * the rental ended still lands somewhere a person will see it.
 */
export function pickBooking<T extends BookingCandidate>(candidates: T[], contactId = ''): T | null {
  const strong = contactId ? candidates.filter((c) => c.ghlContactId === contactId) : [];
  const pool = strong.length ? strong : candidates;
  const newestFirst = [...pool].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return newestFirst.find((c) => c.stage !== 'COMPLETED' && c.stage !== 'CANCELLED') ?? newestFirst[0] ?? null;
}

/** True when the reply is asking to move or cancel: flagged for the office, never acted on. */
export function wantsReschedule(message: string): boolean {
  const upper = message.toUpperCase();
  return /\bRESCHEDULE\b/.test(upper) || /\bCANCEL\b/.test(upper);
}
