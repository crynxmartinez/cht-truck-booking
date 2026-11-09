import { Stage } from '@prisma/client';

/**
 * What moving a booking card from one column to another means.
 *
 * Dragging a card is as easy to do by accident as it is to do on purpose, and a
 * stage is more than a label: texts and the closing-out clock hang off it. This
 * decides, from facts about the booking, whether a move just happens, needs a
 * "yes, I mean it", or is refused unless the office overrides it on the record.
 * The button in the booking and the drag on the Board both use it, and the
 * server checks it again, so neither can skip it. Pure; touches nothing.
 */

export type MoveFacts = {
  from: Stage;
  to: Stage;
  pickupIso: string;
  returnIso: string;
  todayIso: string;
  /** Every agreement on the booking is signed by the renter and approved by a main admin. */
  approvalComplete: boolean;
};

export type MoveVerdict =
  | { level: 'ok' }
  | { level: 'confirm'; reasons: readonly string[] }
  | { level: 'blocked'; reasons: readonly string[] };

/** How much the person at the screen has agreed to. */
export type Ack = 'none' | 'confirmed' | 'override';

export const ACKS: readonly Ack[] = ['none', 'confirmed', 'override'];

/** The order a booking normally travels in, left to right on the Board. */
const ORDER: Stage[] = [
  Stage.NEW_BOOKING,
  Stage.CONTRACT_SENT,
  Stage.ADDITIONAL_DRIVER,
  Stage.AWAITING_APPROVAL,
  Stage.CONFIRMED,
  Stage.PICKUP_DAY,
  Stage.IN_USE,
  Stage.RETURNED,
  Stage.COMPLETED,
];

/** Stages where the renter has, or is about to have, the truck: not without a fully signed agreement. */
const NEEDS_APPROVAL: Stage[] = [Stage.CONFIRMED, Stage.PICKUP_DAY, Stage.IN_USE, Stage.RETURNED];

/** The columns on the Board. Cancelled is deliberately not one: cancelling asks for a reason. */
export const BOARD_STAGE_LIST: readonly Stage[] = ORDER;

export function isBoardStage(v: unknown): v is Stage {
  return typeof v === 'string' && (ORDER as string[]).includes(v);
}

export function checkMove(f: MoveFacts): MoveVerdict {
  if (f.from === f.to) return { level: 'ok' };

  const blocked: string[] = [];
  const confirm: string[] = [];

  if (NEEDS_APPROVAL.includes(f.to) && !f.approvalComplete) {
    blocked.push(
      'The rental agreement is not fully signed and approved yet. Approve it from the booking instead, which confirms it properly.',
    );
  }

  if (f.from === Stage.COMPLETED) {
    confirm.push(
      'This reopens a finished booking. Its closed-out date is cleared and the clock for removing the renter’s ID and photos is stopped.',
    );
  }

  if (f.to === Stage.COMPLETED) {
    confirm.push(
      'Completing closes the booking, frees the truck, and starts the clock for removing the renter’s ID and photos (nothing is removed unless automatic deleting is on in Settings).',
    );
  }

  if (ORDER.indexOf(f.to) < ORDER.indexOf(f.from) && f.from !== Stage.COMPLETED) {
    confirm.push('This moves the booking back a step.');
  }

  const pickupToday = f.pickupIso === f.todayIso;
  if (pickupToday && (f.to === Stage.CONFIRMED || f.to === Stage.PICKUP_DAY)) {
    confirm.push('Pickup is today. Texts depend on this stage, so check the renter gets their lockbox code.');
  }

  const dueToday = f.returnIso === f.todayIso;
  if (dueToday && (f.to === Stage.IN_USE || f.to === Stage.PICKUP_DAY)) {
    confirm.push('It is due back today, so the return reminder text can go out.');
  }

  if (blocked.length) return { level: 'blocked', reasons: [...blocked, ...confirm] };
  if (confirm.length) return { level: 'confirm', reasons: confirm };
  return { level: 'ok' };
}

/** Has the person agreed to enough for this verdict? Blocked needs an override; confirm needs either. */
export function ackCovers(verdict: MoveVerdict, ack: Ack): boolean {
  if (verdict.level === 'ok') return true;
  if (verdict.level === 'confirm') return ack === 'confirmed' || ack === 'override';
  return ack === 'override';
}

export function isAck(v: unknown): v is Ack {
  return typeof v === 'string' && (ACKS as readonly string[]).includes(v);
}
