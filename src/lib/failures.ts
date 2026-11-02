/**
 * What a failed message means, in words the office can act on.
 *
 * GoHighLevel's own errors are accurate but not helpful ("Cannot send message
 * as DND is active for SMS"). This turns them into a reason and a next step.
 *
 * Deliberately never suggests getting around a block. A renter with Do Not
 * Disturb on, or who replied STOP, has told us not to text them; carriers and
 * US law treat texting past that as a violation, and GoHighLevel refuses to do
 * it anyway. The next step is always a phone call or the email.
 */

export type FailureKind = 'dnd' | 'unsubscribed' | 'bad_number' | 'other';

export type Explained = { kind: FailureKind; reason: string; action: string };

export function explainFailure(error: string | null | undefined, channel: string): Explained {
  const text = (error ?? '').trim();

  if (/dnd is active|do not disturb/i.test(text)) {
    return {
      kind: 'dnd',
      reason: 'This person has Do Not Disturb switched on in GoHighLevel, so texts to them are blocked.',
      action:
        'We cannot text them. Call them, or check they received the email. Leave Do Not Disturb as it is unless they ask you to change it.',
    };
  }

  if (/unsubscrib|opted.?out|\bstop\b/i.test(text)) {
    return {
      kind: 'unsubscribed',
      reason: 'They replied STOP at some point, so they have opted out of our texts.',
      action: 'Do not text them again. Call them, and check they received the email.',
    };
  }

  if (channel === 'SMS' && /phone|number/i.test(text) && /invalid|required|missing|not valid|format/i.test(text)) {
    return {
      kind: 'bad_number',
      reason: 'The phone number on the booking is missing or not valid.',
      action: 'Check the number on the booking and correct it, then press Resend on the booking.',
    };
  }

  return {
    kind: 'other',
    reason: text ? `The message did not go out: ${text}` : 'The message did not go out, and no reason was recorded.',
    action: 'Press Resend on the booking once the cause is fixed. If it keeps failing, tell your developer.',
  };
}

const PICKUP_TEXTS = ['pickup_morning', 'pickup_reminder', 'pickup_no_show_check'];
const NOT_COLLECTED = ['CONFIRMED', 'PICKUP_DAY'];

/**
 * A failed text that carried the lockbox code, for a renter who has not yet
 * collected the truck and whose pickup is today or still ahead, means somebody
 * may be standing at the yard with no way in. That one is not like the others.
 */
export function isUrgentFailure(f: {
  channel: string;
  template: string;
  stage: string;
  pickupIso: string;
  todayIso: string;
}): boolean {
  return (
    f.channel === 'SMS' &&
    PICKUP_TEXTS.includes(f.template) &&
    NOT_COLLECTED.includes(f.stage) &&
    f.pickupIso >= f.todayIso
  );
}
