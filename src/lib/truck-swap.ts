export type SwapVerdict = { ok: true } | { ok: false; reason: string };

export type SwapWindow = { stage: string; pickupDate: string; today: string };

export type SwapCheck = SwapWindow & {
  currentTruckId: string | null;
  target: { id: string; code: string; active: boolean };
};

export function swapWindowOpen(_w: SwapWindow): SwapVerdict {
  return { ok: true };
}

export function checkSwap(_c: SwapCheck): SwapVerdict {
  return { ok: true };
}
