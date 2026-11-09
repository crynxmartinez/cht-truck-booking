import { blockedKind } from './sms-consent';

/**
 * A message the office writes by hand to a renter.
 *
 * Preparing it is separate from sending it, so the screen can show exactly
 * what will go, to whom, before anything does. Pure: it decides from the
 * booking and the message history, and touches nothing.
 *
 * The one hard rule: a text is never sent to someone who has opted out or has
 * Do Not Disturb on. It is dropped, the office is told why, and the email goes
 * if they chose one. The only way back is the renter asking for texts again,
 * recorded on the booking (sms-consent.ts); nothing here goes round it.
 */

export const MAX_SMS_LENGTH = 480; // three text segments
export const MAX_EMAIL_LENGTH = 5000;
const MAX_SUBJECT_LENGTH = 150;

export type OfficeMessageInput = { text: string; subject: string; sms: boolean; email: boolean };

export type MessageHistory = { channel: string; to: string | null; status: string; error: string | null; at: Date };

type BookingFacts = { firstName: string; lastName: string; email: string; phone: string; stage: string };

export type Recipient = { channel: 'SMS' | 'EMAIL'; address: string };

export type Preview = {
  recipients: Recipient[];
  subject: string;
  text: string;
  warnings: string[];
};

export type Prepared = { ok: true; preview: Preview } | { ok: false; errors: string[] };

/**
 * Has the most recent text to THIS number been refused because they opted out
 * or have Do Not Disturb on? Judged per number: a text that worked for the
 * second driver says nothing about the renter, and the reverse.
 */
function textBlocked(history: MessageHistory[], phone: string, restoredAt?: Date | null): string | null {
  const kind = blockedKind(history, phone, restoredAt);
  if (kind === 'dnd') return 'has Do Not Disturb switched on, so texts to them are blocked';
  if (kind === 'unsubscribed') return 'has opted out of our texts';
  return null;
}

export function prepareOfficeMessage(
  booking: BookingFacts,
  input: OfficeMessageInput,
  history: MessageHistory[],
  restoredAt?: Date | null,
): Prepared {
  const errors: string[] = [];
  const text = input.text.trim();
  const subject = input.subject.trim();

  if (text.length < 2) errors.push('Write the message first.');
  // The email template turns [[Label|link]] into a button, so what is shown could differ from where it goes.
  if (text.includes('[[') || text.includes(']]')) {
    errors.push('Please take out the double square brackets, which are reserved for buttons in our own emails.');
  }
  if (!input.sms && !input.email) errors.push('Choose text, email, or both.');
  if (input.sms && text.length > MAX_SMS_LENGTH) {
    errors.push(`A text can be at most ${MAX_SMS_LENGTH} characters; this one is ${text.length}. Shorten it, or send it by email only.`);
  }
  if (input.email && text.length > MAX_EMAIL_LENGTH) {
    errors.push(`An email can be at most ${MAX_EMAIL_LENGTH} characters.`);
  }
  if (input.email && subject.length < 2) errors.push('Give the email a subject.');
  if (input.email && subject.length > MAX_SUBJECT_LENGTH) errors.push(`The subject can be at most ${MAX_SUBJECT_LENGTH} characters.`);
  if (errors.length) return { ok: false, errors };

  const name = `${booking.firstName} ${booking.lastName}`.trim();
  const warnings: string[] = [];
  const recipients: Recipient[] = [];

  if (input.sms) {
    const blocked = textBlocked(history, booking.phone, restoredAt);
    if (!booking.phone.trim()) {
      warnings.push(`${name} has no phone number on the booking, so no text will be sent.`);
    } else if (blocked) {
      warnings.push(
        `${name} ${blocked}. No text will be sent${input.email ? ', only the email' : ''}. Call them if it is urgent.`,
      );
    } else {
      recipients.push({ channel: 'SMS', address: booking.phone });
    }
  }
  if (input.email) recipients.push({ channel: 'EMAIL', address: booking.email });

  if (recipients.length === 0) {
    return {
      ok: false,
      errors: [...warnings, 'Nothing can be sent as chosen. Send it by email, or call them.'],
    };
  }

  if (booking.stage === 'CANCELLED') warnings.push('This rental is cancelled. Check this message still makes sense for them.');

  return { ok: true, preview: { recipients, subject, text, warnings } };
}
