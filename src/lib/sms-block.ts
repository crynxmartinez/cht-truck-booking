/**
 * Reading and changing a contact's Do Not Disturb settings in GoHighLevel, as
 * pure functions so the safety claims can be tested without GoHighLevel.
 *
 * Two promises live here:
 *  - texts count as blocked unless GoHighLevel clearly says they are not, so an
 *    odd or empty answer never reads as "safe to send";
 *  - when we change the text setting, every other channel is sent back exactly
 *    as it was read, and checked again afterwards.
 */

export type ChannelDnd = { status?: string; message?: string; code?: string };
export type DndSettings = Record<string, ChannelDnd>;

export type SmsBlock = {
  blocked: boolean;
  /** What GoHighLevel said for texts, lower-cased; 'global' when the whole contact is on Do Not Disturb. */
  status: string;
  /** Every channel as read, so a change can send the others back untouched. */
  settings: DndSettings;
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Accepts either `{ contact: {...} }` or the contact at the top level. */
export function parseSmsBlock(json: unknown): SmsBlock {
  const root = isObject(json) ? json : {};
  const contact = isObject(root.contact) ? root.contact : root;
  const settings: DndSettings = isObject(contact.dndSettings) ? (contact.dndSettings as DndSettings) : {};

  // The whole contact on Do Not Disturb blocks texts too, and clearing the text
  // setting does not clear it.
  if (contact.dnd === true) return { blocked: true, status: 'global', settings };

  const sms = settings.SMS;
  const raw = isObject(sms) && sms.status !== undefined && sms.status !== null ? String(sms.status).toLowerCase() : null;
  // Nothing set for texts at all means not blocked; anything we do not
  // recognise (including an empty string) is treated as blocked.
  const status = raw === null ? 'inactive' : raw;
  return { blocked: status !== 'inactive', status, settings };
}

export const SMS_REASON_MAX = 200;

/**
 * The update that turns texts back on. Every other channel is passed through as
 * it was read; only SMS changes. Nothing outside dndSettings is sent.
 */
export function allowSmsBody(current: DndSettings, reason: string): { dndSettings: DndSettings } {
  return {
    dndSettings: {
      ...current,
      SMS: { status: 'inactive', message: reason.slice(0, SMS_REASON_MAX), code: '' },
    },
  };
}

/** Channels other than texts whose setting differs between two reads. Empty means untouched. */
export function otherChannelsChanged(before: DndSettings, after: DndSettings): string[] {
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  names.delete('SMS');
  const status = (s: DndSettings, k: string) => String(s[k]?.status ?? 'inactive').toLowerCase();
  return [...names].filter((k) => status(before, k) !== status(after, k)).sort();
}
