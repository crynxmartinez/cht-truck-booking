/**
 * When may a booking be moved to the other truck?
 *
 * Any time before its booking period — and on the first day too, right up
 * until the lockbox code goes out. The code is what makes a swap unsafe: each
 * truck has its own, so a renter who already holds the old truck's code would
 * be standing at the wrong lockbox. Once the rental has started the truck is
 * physically with them, and a finished or cancelled booking has nothing to move.
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
  /** The pickup-day lockbox code has been queued or sent. */
  codeSent: boolean;
};

export type SwapCheck = SwapWindow & {
  currentTruckId: string | null;
  target: { id: string; code: string; active: boolean };
};

/** Stages in which the renter has not yet collected the truck. */
const BEFORE_PICKUP = new Set([
  'NEW_BOOKING',
  'CONTRACT_SENT',
  'ADDITIONAL_DRIVER',
  'AWAITING_APPROVAL',
  'CONFIRMED',
]);

/** Is this booking in a state where a truck swap is possible at all? */
export function swapWindowOpen({ stage, pickupDate, today, codeSent }: SwapWindow): SwapVerdict {
  if (!BEFORE_PICKUP.has(stage)) {
    return {
      ok: false,
      reason: 'The rental has already started or finished, so its truck can no longer be swapped.',
    };
  }
  if (pickupDate < today) {
    return { ok: false, reason: 'The pickup date has passed, so the truck can no longer be swapped.' };
  }
  if (pickupDate === today && codeSent) {
    return {
      ok: false,
      reason: "Today's lockbox code has already gone out, so the truck can no longer be swapped.",
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
