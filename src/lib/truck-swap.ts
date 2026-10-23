/**
 * When may a booking be moved to the other truck?
 *
 * Only once it has been accepted, and only until its pickup day arrives.
 * Before acceptance the truck is still being assigned automatically; from
 * pickup day on, the lockbox code (which differs per truck) may already be in
 * the renter's hands, and once they have collected it the truck is physically
 * with them.
 *
 * Pure, so the rule can be pinned by tests and shared by the button, the
 * server action and the data layer without any of them drifting.
 */

export type SwapVerdict = { ok: true } | { ok: false; reason: string };

export type SwapWindow = {
  stage: string;
  /** YYYY-MM-DD */
  pickupDate: string;
  /** Today at the yard, YYYY-MM-DD */
  today: string;
};

export type SwapCheck = SwapWindow & {
  currentTruckId: string | null;
  target: { id: string; code: string; active: boolean };
};

const ACCEPTED = 'CONFIRMED';

/** Is this booking in a state where a truck swap is possible at all? */
export function swapWindowOpen({ stage, pickupDate, today }: SwapWindow): SwapVerdict {
  if (stage !== ACCEPTED) {
    return {
      ok: false,
      reason: 'A booking can only change trucks once it has been accepted and before its pickup day.',
    };
  }
  if (pickupDate <= today) {
    return {
      ok: false,
      reason: 'Pickup day has arrived, so the truck can no longer be swapped.',
    };
  }
  return { ok: true };
}

/** Can this booking move onto this particular truck? */
export function checkSwap(c: SwapCheck): SwapVerdict {
  const window = swapWindowOpen(c);
  if (!window.ok) return window;

  if (c.currentTruckId !== null && c.target.id === c.currentTruckId) {
    return { ok: false, reason: `It is already on Truck ${c.target.code}.` };
  }
  if (!c.target.active) {
    return {
      ok: false,
      reason: `Truck ${c.target.code} is switched off. Turn it on in Trucks & lockboxes first.`,
    };
  }
  return { ok: true };
}
