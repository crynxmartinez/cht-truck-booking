import { explainFailure } from './failures';

/**
 * Turning a renter's texts back on, with their say-so.
 *
 * A renter who replied STOP, or has Do Not Disturb on, has told us not to text
 * them. We never switch that off on our own, and nothing here lets a text go
 * past it. The one legitimate route is the renter asking for texts again: they
 * tell the office, the office records how and when, and only then is the block
 * cleared. This module decides whether the block is there and whether that
 * record is good enough. It touches nothing.
 */

export type BlockKind = 'dnd' | 'unsubscribed';

export type SmsHistory = { channel: string; to: string | null; status: string; error: string | null; at: Date };

/**
 * Is the most recent text to THIS number blocked because they opted out or have
 * Do Not Disturb on? Judged per number, and a later text that went through
 * clears it: the block is gone, whoever removed it. So does a recorded
 * turn-back-on that came after the failure.
 */
export function blockedKind(history: SmsHistory[], phone: string, restoredAt?: Date | null): BlockKind | null {
  const latest = history
    .filter((m) => m.channel === 'SMS' && m.to === phone)
    .sort((a, b) => b.at.getTime() - a.at.getTime())[0];
  if (!latest || latest.status !== 'FAILED') return null;
  // Texts were turned back on after that failure, so it no longer describes them.
  if (restoredAt && restoredAt.getTime() > latest.at.getTime()) return null;
  const why = explainFailure(latest.error, 'SMS');
  return why.kind === 'dnd' || why.kind === 'unsubscribed' ? why.kind : null;
}

export const CONSENT_WAYS = [
  { key: 'phone', label: 'They asked us on a phone call' },
  { key: 'in_person', label: 'They asked us in person' },
  { key: 'email', label: 'They asked us by email' },
  { key: 'text', label: 'They asked us by text, or replied START' },
  { key: 'misread', label: "They didn't mean to opt out (a normal message was read as STOP)" },
] as const;

export type ConsentWay = (typeof CONSENT_WAYS)[number]['key'];

export const MIN_NOTE = 8;
export const MAX_NOTE = 300;

export type ConsentCheck =
  | { ok: true; way: ConsentWay; wayLabel: string; note: string }
  | { ok: false; error: string };

/**
 * The record has to say how they asked and give one line a person can check
 * later (who they spoke to, and when). Anything else is refused, so a block is
 * never cleared by a stray click.
 */
export function checkConsent(way: unknown, note: unknown): ConsentCheck {
  const found = CONSENT_WAYS.find((w) => w.key === way);
  if (!found) return { ok: false, error: 'Choose how the renter asked for texts again.' };

  const text = typeof note === 'string' ? note.trim() : '';
  if (text.length < MIN_NOTE) {
    return { ok: false, error: 'Write who they spoke to and when, so there is a record (a short line is enough).' };
  }
  if (text.length > MAX_NOTE) return { ok: false, error: `Keep the note under ${MAX_NOTE} characters.` };

  return { ok: true, way: found.key, wayLabel: found.label, note: text };
}

/** What goes in the booking's history. */
export function consentLogLine(check: Extract<ConsentCheck, { ok: true }>): string {
  return `Texts turned back on at the renter's request. ${check.wayLabel}. Note: ${check.note}`;
}
