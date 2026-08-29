import { Stage } from '@prisma/client';

/** The board, in order, with the colour and the plain-English meaning. */
export const STAGE_META: Array<{
  stage: Stage;
  label: string;
  dot: string;
  blurb: string;
}> = [
  { stage: Stage.NEW_BOOKING, label: 'New Booking', dot: '#1f5b99', blurb: 'Form in, truck assigned, contract going out.' },
  { stage: Stage.CONTRACT_SENT, label: 'Contract Sent', dot: '#8f5e0a', blurb: 'Waiting on the renter’s signature.' },
  { stage: Stage.ADDITIONAL_DRIVER, label: 'Additional Driver', dot: '#7c4dbd', blurb: 'Second driver still to sign.' },
  { stage: Stage.CONFIRMED, label: 'Confirmed', dot: '#0f7b4f', blurb: 'All signed. Waiting for pickup day.' },
  { stage: Stage.PICKUP_DAY, label: 'Pickup Day', dot: '#d6001c', blurb: 'Lockbox code sent. Awaiting pickup photos.' },
  { stage: Stage.IN_USE, label: 'In Use', dot: '#c2410c', blurb: 'Truck is out on the road.' },
  { stage: Stage.RETURNED, label: 'Returned', dot: '#0891b2', blurb: 'Back and photographed. Give it a look.' },
  { stage: Stage.COMPLETED, label: 'Completed', dot: '#6b6e73', blurb: 'Closed out. Truck released.' },
];

export const STAGE_LABEL: Record<Stage, string> = {
  NEW_BOOKING: 'New Booking',
  CONTRACT_SENT: 'Contract Sent',
  ADDITIONAL_DRIVER: 'Additional Driver',
  CONFIRMED: 'Confirmed',
  PICKUP_DAY: 'Pickup Day',
  IN_USE: 'In Use',
  RETURNED: 'Returned',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const BOARD_STAGES = STAGE_META.map((s) => s.stage);
