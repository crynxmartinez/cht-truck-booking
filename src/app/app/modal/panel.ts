import type { Stage } from '@prisma/client';
import type { ActionResult } from '../actions';
import type { BookingDetail } from '../types';

/** What every section of the booking window is given. */
export type PanelProps = {
  detail: BookingDetail;
  /** The column this booking is in now (it changes when it is moved from the window). */
  stage: Stage;
  pending: boolean;
  /** Runs an action and shows its result at the top of the window. */
  run: (fn: () => Promise<ActionResult>) => void;
  moveTo: (to: Stage) => Promise<ActionResult>;
};
