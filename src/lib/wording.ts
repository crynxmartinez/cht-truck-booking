import { renderDefault, type MessageContext, type TemplateKey } from './messages';
import { PLACEHOLDERS, fillWording, isPlaceholder, placeholdersIn, strayBrackets, type Wording } from './wording-fill';
import { wordingValues } from './wording-values';

export { wordingValues };
export type { Wording };

/**
 * Editing what the system says to renters.
 *
 * The office edits a copy of today's text in which the parts that change per
 * renter (their name, the dates, the links, the lockbox code) are placeholders
 * like {firstName}. An edit cannot be saved without the placeholders that make
 * the message work: lose the sign link from the agreement message, or the
 * lockbox code from the pickup text, and it is refused.
 */

/** Wording that depends on the situation (is the pickup today? did they already sign?), so one fixed text would sometimes say something untrue. */
export const LOCKED: TemplateKey[] = ['truck_changed'];

export const EDITABLE: TemplateKey[] = [
  'booking_received',
  'contract_to_sign',
  'contract_nudge',
  'additional_driver',
  'dates_changed',
  'rental_confirmed',
  'pickup_morning',
  'pickup_reminder',
  'pickup_no_show_check',
  'return_day',
  'overdue',
  'thank_you',
];

const ALL: TemplateKey[] = [...EDITABLE, ...LOCKED];

/** A message that goes out without one of these is broken, not just reworded. */
const CRITICAL = ['signLink', 'pickupChecklistLink', 'returnChecklistLink', 'lockboxCode'] as const;
const CRITICAL_WHY: Record<(typeof CRITICAL)[number], string> = {
  signLink: 'the link to sign the agreement',
  pickupChecklistLink: 'the pickup checklist link',
  returnChecklistLink: 'the return checklist link',
  lockboxCode: 'the lockbox code',
};

export const MAX_SUBJECT = 150;
export const MAX_SMS = 480;
export const MAX_EMAIL = 5000;

/** A renter made of values that cannot occur in the real text, so each can be swapped back for its placeholder. */
const SAMPLE: MessageContext = {
  firstName: 'Qfirst',
  lastName: 'Qlast',
  reference: 'CHT-QREF',
  truckCode: 'Q',
  pickupDate: '2099-05-06',
  returnDate: '2099-05-08',
  lockboxCode: 'QCODE9',
  contractToken: 'qsign',
  pickupChecklistToken: 'qpick',
  dropoffChecklistToken: 'qdrop',
  additionalDriverName: 'Qdriver Qname',
  renterName: 'Qrenter Qname',
  agreementSigned: true,
  pickupIsToday: false,
};

/**
 * Today's built-in text for a message, with the parts that change per renter
 * turned back into placeholders. Made by rendering a sample renter and
 * swapping each of their values for its placeholder, so it can never drift
 * from the real templates.
 */
export function defaultWording(key: TemplateKey): Wording {
  const rendered = renderDefault(key, SAMPLE);
  const values = wordingValues(SAMPLE);

  // Longest first, so a long date is replaced before the short one inside it.
  const swaps = PLACEHOLDERS.map((p) => ({ from: values[p.name], to: `{${p.name}}` }))
    .filter((s) => s.from)
    .sort((a, b) => b.from.length - a.from.length);

  const back = (text: string) => swaps.reduce((t, s) => t.split(s.from).join(s.to), text);
  return { subject: back(rendered.subject), email: back(rendered.email), sms: back(rendered.sms) };
}

export type Validated = { ok: true } | { ok: false; errors: string[] };

export function validateWording(key: TemplateKey, w: Wording): Validated {
  if (!ALL.includes(key)) return { ok: false, errors: ['That is not one of our messages.'] };
  if (LOCKED.includes(key)) {
    return { ok: false, errors: ['The wording of this message depends on the situation, so it cannot be changed here.'] };
  }

  const errors: string[] = [];
  const subject = w.subject.trim();
  const email = w.email.trim();
  const sms = w.sms.trim();

  if (subject.length < 2) errors.push('The email subject cannot be empty.');
  if (subject.length > MAX_SUBJECT) errors.push(`The email subject can be at most ${MAX_SUBJECT} characters.`);
  if (sms.length < 2) errors.push('The text message cannot be empty.');
  if (sms.length > MAX_SMS) errors.push(`The text message can be at most ${MAX_SMS} characters.`);
  if (email.length < 2) errors.push('The email cannot be empty.');
  if (email.length > MAX_EMAIL) errors.push(`The email can be at most ${MAX_EMAIL} characters.`);

  // Anything in curly brackets that is not a proper placeholder would reach the
  // renter with the brackets showing: "{ firstName }", "{first_name}", "{{signLink}}".
  for (const [label, text] of [['email subject', subject], ['text message', sms], ['email', email]] as const) {
    if (strayBrackets(text)) {
      errors.push(`The ${label} has a curly bracket that is not part of a placeholder. Brackets are only for placeholders such as {firstName}, with no spaces inside.`);
    }
  }

  const unknown = new Set<string>();
  for (const text of [subject, sms, email]) for (const name of placeholdersIn(text)) if (!isPlaceholder(name)) unknown.add(name);
  for (const name of unknown) errors.push(`{${name}} is not a placeholder we know. Use the list beside the editor.`);

  // Each of the text and the email must keep what the built-in version needs:
  // losing the link from one is not made good by the other having it.
  const original = defaultWording(key);
  for (const [label, field, was] of [
    ['email subject', subject, original.subject],
    ['text message', sms, original.sms],
    ['email', email, original.email],
  ] as const) {
    for (const name of CRITICAL) {
      const had = placeholdersIn(was).includes(name);
      const has = placeholdersIn(field).includes(name);
      if (had && !has && label !== 'email subject') {
        errors.push(`The ${label} must keep {${name}}, ${CRITICAL_WHY[name]}. Without it the message would not work.`);
      }
      // The reverse matters as much: the lockbox code in a message sent before
      // someone has signed, or a link where it was never meant to be, is a leak
      // as much as a missing link is a break.
      if (has && !had) {
        errors.push(`{${name}} (${CRITICAL_WHY[name]}) cannot be added to the ${label} of this message, because the original does not have it there.`);
      }
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true };
}

export type Preview = { ok: true; rendered: Wording } | { ok: false; missing: string[] };

/** What this wording would say for a given renter. */
export function previewWording(_key: TemplateKey, w: Wording, ctx: MessageContext): Preview {
  const filled = fillWording(w, wordingValues(ctx));
  return filled.ok ? { ok: true, rendered: filled.wording } : { ok: false, missing: filled.missing };
}

/** A made-up renter for showing an edit before it is saved. The lockbox code is a marker, never a real one. */
export const PREVIEW_RENTER: MessageContext = {
  firstName: 'Sample',
  lastName: 'Renter',
  reference: 'CHT-SAMPLE',
  truckCode: 'A',
  pickupDate: '2026-12-10',
  returnDate: '2026-12-12',
  lockboxCode: '[lockbox code]',
  contractToken: 'sample-link',
  pickupChecklistToken: 'sample-link',
  dropoffChecklistToken: 'sample-link',
  additionalDriverName: 'Sample Driver',
  renterName: 'Sample Renter',
  agreementSigned: true,
};
