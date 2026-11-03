/**
 * Message wording with placeholders, such as "Hi {firstName}, sign here:
 * {signLink}". Pure: no dependency on the templates themselves, so the message
 * code can use it without a cycle.
 */

export type Wording = { subject: string; email: string; sms: string };

export const PLACEHOLDERS = [
  { name: 'firstName', label: 'Renter’s first name', example: 'Marisol' },
  { name: 'renterName', label: 'Renter’s full name (used in the second driver message)', example: 'Marisol Vega' },
  { name: 'driverName', label: 'Second driver’s name', example: 'Tomas Vega' },
  { name: 'reference', label: 'Booking reference', example: 'CHT-8KQ2' },
  { name: 'truck', label: 'The truck, e.g. “Truck A”', example: 'Truck A' },
  { name: 'pickupDate', label: 'Pickup date, written out', example: 'Thursday, December 3, 2026' },
  { name: 'returnDate', label: 'Return date, written out', example: 'Saturday, December 5, 2026' },
  { name: 'pickupDateShort', label: 'Pickup date, short', example: 'Dec 3, 2026' },
  { name: 'returnDateShort', label: 'Return date, short', example: 'Dec 5, 2026' },
  { name: 'pickupDateIso', label: 'Pickup date as 2026-12-03 (used in the confirmation block)', example: '2026-12-03' },
  { name: 'returnDateIso', label: 'Return date as 2026-12-05', example: '2026-12-05' },
  { name: 'pickupAddress', label: 'Where the truck is collected', example: '25220 Hancock Ave, Murrieta' },
  { name: 'pickupHour', label: 'Time the pickup-day text goes out (from Settings)', example: '6 AM' },
  { name: 'lockboxCode', label: 'The lockbox code for their truck', example: '12345' },
  { name: 'signLink', label: 'Link to sign the agreement', example: 'https://…/sign/…' },
  { name: 'pickupChecklistLink', label: 'Link to the pickup checklist', example: 'https://…/checklist/…' },
  { name: 'returnChecklistLink', label: 'Link to the return checklist', example: 'https://…/checklist/…' },
] as const;

export type PlaceholderName = (typeof PLACEHOLDERS)[number]['name'];

const NAMES = new Set<string>(PLACEHOLDERS.map((p) => p.name));
const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

export const isPlaceholder = (name: string): name is PlaceholderName => NAMES.has(name);

/** Each placeholder used in the text, once, in the order it first appears. */
export function placeholdersIn(text: string): string[] {
  const seen: string[] = [];
  for (const m of text.matchAll(PLACEHOLDER)) if (!seen.includes(m[1])) seen.push(m[1]);
  return seen;
}

export type Filled = { ok: true; wording: Wording } | { ok: false; missing: string[] };

/**
 * Put the values in. Refuses, naming the problem, rather than send a blank
 * where a value should be or print the braces of a name that does not exist.
 * Done in a single pass, so a value that itself contains braces is not filled
 * a second time.
 */
export function fillWording(w: Wording, values: Record<string, string>): Filled {
  const missing: string[] = [];
  const all = `${w.subject}\n${w.email}\n${w.sms}`;
  for (const name of placeholdersIn(all)) {
    if (!isPlaceholder(name) || !values[name]) missing.push(name);
  }
  if (missing.length) return { ok: false, missing };

  const fill = (text: string) => text.replace(PLACEHOLDER, (_m, name: string) => values[name]);
  return { ok: true, wording: { subject: fill(w.subject), email: fill(w.email), sms: fill(w.sms) } };
}
