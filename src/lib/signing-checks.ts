/**
 * The ticks a renter must give before their signature counts.
 *
 * Each is its own checkbox, stored with its own timestamp, rather than buried
 * in the terms: these are the clauses most likely to be disputed weeks later,
 * when a toll notice arrives or a truck comes back low on fuel, and a tick
 * with a time beside it is worth more than a paragraph nobody remembers.
 *
 * Only a real `true` counts. A string "true" or the number 1 is a malformed
 * request, not consent.
 */
export type Acknowledgements = {
  tollAccepted?: unknown;
  gasAccepted?: unknown;
  dollyAccepted?: unknown;
};

/** The first thing still missing, in words for the renter, or null if they are all given. */
export function missingAcknowledgement(a: Acknowledgements): string | null {
  if (a.tollAccepted !== true) return 'Please agree to cover any tolls before signing.';
  if (a.gasAccepted !== true) return 'Please agree to return the truck with the fuel it had before signing.';
  if (a.dollyAccepted !== true) return 'Please agree to return the dolly before signing.';
  return null;
}
