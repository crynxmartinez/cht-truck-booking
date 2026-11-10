/**
 * Which files may be removed from cloud storage once they are saved elsewhere.
 *
 * This only ever decides; it deletes nothing. A file is cleared only if EVERY
 * test passes, so a doubt in any direction keeps the file:
 *  - it belongs to a finished rental, closed more than `minAgeDays` ago, with
 *    nothing flagged for review;
 *  - it is not a signed agreement (those always stay in the cloud);
 *  - it was re-read from the backup folder just now and matched what the cloud
 *    holds; and, when a second copy is required, from that folder too.
 */

export type ClearCandidate = {
  documentId: string;
  pathname: string;
  bytes: number;
  kind: string;
  bookingId: string | null;
  reference: string | null;
  stage: string | null;
  overdue: boolean;
  needsReview: boolean;
  completedAt: Date | null;
  deletedAt: Date | null;
};

export type ClearOptions = {
  now: Date;
  minAgeDays: number;
  /** Paths whose copy in the first backup folder was just checked and is intact. */
  verifiedFirst: ReadonlySet<string>;
  /** Same for the second folder, or null when no second copy is required. */
  verifiedSecond: ReadonlySet<string> | null;
};

export type KeepReason =
  | 'already removed'
  | 'signed agreement (always kept)'
  | 'rental not finished'
  | 'flagged for review'
  | 'finished too recently'
  | 'not saved in the backup folder'
  | 'not saved in the second folder';

export type ClearPlan = {
  clear: ClearCandidate[];
  keep: Array<{ reason: KeepReason; count: number }>;
  bookings: number;
  bytes: number;
};

const DAY = 86_400_000;

export function whyKeep(c: ClearCandidate, o: ClearOptions): KeepReason | null {
  if (c.deletedAt) return 'already removed';
  if (c.kind === 'SIGNED_CONTRACT') return 'signed agreement (always kept)';
  if (c.stage !== 'COMPLETED' || !c.bookingId) return 'rental not finished';
  if (c.overdue || c.needsReview) return 'flagged for review';
  if (!c.completedAt || o.now.getTime() - c.completedAt.getTime() < o.minAgeDays * DAY) return 'finished too recently';
  if (!o.verifiedFirst.has(c.pathname)) return 'not saved in the backup folder';
  if (o.verifiedSecond && !o.verifiedSecond.has(c.pathname)) return 'not saved in the second folder';
  return null;
}

export function planClear(candidates: ClearCandidate[], o: ClearOptions): ClearPlan {
  const clear: ClearCandidate[] = [];
  const counts = new Map<KeepReason, number>();
  for (const c of candidates) {
    const why = whyKeep(c, o);
    if (why) counts.set(why, (counts.get(why) ?? 0) + 1);
    else clear.push(c);
  }
  return {
    clear,
    keep: [...counts].map(([reason, count]) => ({ reason, count })),
    bookings: new Set(clear.map((c) => c.bookingId)).size,
    bytes: clear.reduce((n, c) => n + c.bytes, 0),
  };
}
