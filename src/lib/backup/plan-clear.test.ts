import { describe, expect, it } from 'vitest';
import { planClear, whyKeep, type ClearCandidate, type ClearOptions } from './plan-clear';

const NOW = new Date('2026-12-31T00:00:00Z');

const doc = (over: Partial<ClearCandidate> = {}): ClearCandidate => ({
  documentId: 'd1', pathname: 'docs/d1.webp', bytes: 1000, kind: 'DRIVER_LICENSE', bookingId: 'b1', reference: 'CHT-SAMPLE',
  stage: 'COMPLETED', overdue: false, needsReview: false, completedAt: new Date('2026-11-01T00:00:00Z'), deletedAt: null, ...over,
});

const opts = (over: Partial<ClearOptions> = {}): ClearOptions => ({
  now: NOW, minAgeDays: 30, verifiedFirst: new Set(['docs/d1.webp']), verifiedSecond: null, ...over,
});

describe('whyKeep', () => {
  it('clears a verified file from a rental finished long enough ago', () => {
    expect(whyKeep(doc(), opts())).toBeNull();
  });

  it('keeps a signed agreement, however old', () => {
    expect(whyKeep(doc({ kind: 'SIGNED_CONTRACT' }), opts())).toBe('signed agreement (always kept)');
  });

  it.each(['NEW_BOOKING', 'CONTRACT_SENT', 'CONFIRMED', 'PICKUP_DAY', 'IN_USE', 'RETURNED', 'CANCELLED'])(
    'keeps files of a rental that is %s',
    (stage) => {
      expect(whyKeep(doc({ stage }), opts())).toBe('rental not finished');
    },
  );

  it('keeps uploads that belong to no booking (those have their own cleanup)', () => {
    expect(whyKeep(doc({ bookingId: null, stage: null }), opts())).toBe('rental not finished');
  });

  it('keeps anything flagged for review or overdue', () => {
    expect(whyKeep(doc({ needsReview: true }), opts())).toBe('flagged for review');
    expect(whyKeep(doc({ overdue: true }), opts())).toBe('flagged for review');
  });

  it('keeps a rental that finished too recently, and one with no finish date', () => {
    expect(whyKeep(doc({ completedAt: new Date('2026-12-15T00:00:00Z') }), opts())).toBe('finished too recently');
    expect(whyKeep(doc({ completedAt: null }), opts())).toBe('finished too recently');
  });

  it('draws the age line exactly: 29 days kept, 30 days cleared', () => {
    expect(whyKeep(doc({ completedAt: new Date('2026-12-02T00:00:00Z') }), opts())).toBe('finished too recently');
    expect(whyKeep(doc({ completedAt: new Date('2026-12-01T00:00:00Z') }), opts())).toBeNull();
  });

  it('keeps a file that was not found intact in the backup folder', () => {
    expect(whyKeep(doc(), opts({ verifiedFirst: new Set() }))).toBe('not saved in the backup folder');
  });

  it('with a second copy required, keeps what is not in it', () => {
    expect(whyKeep(doc(), opts({ verifiedSecond: new Set() }))).toBe('not saved in the second folder');
    expect(whyKeep(doc(), opts({ verifiedSecond: new Set(['docs/d1.webp']) }))).toBeNull();
  });

  it('keeps a file already removed', () => {
    expect(whyKeep(doc({ deletedAt: new Date('2026-12-01T00:00:00Z') }), opts())).toBe('already removed');
  });
});

describe('planClear', () => {
  it('plans only the files that pass every test, and counts the rest by reason', () => {
    const plan = planClear(
      [
        doc({ documentId: 'a', pathname: 'docs/a', bytes: 100, bookingId: 'b1' }),
        doc({ documentId: 'b', pathname: 'docs/b', bytes: 200, bookingId: 'b1' }),
        doc({ documentId: 'c', pathname: 'docs/c', bytes: 400, bookingId: 'b2' }),
        doc({ documentId: 'd', pathname: 'docs/d', kind: 'SIGNED_CONTRACT' }),
        doc({ documentId: 'e', pathname: 'docs/e', stage: 'IN_USE' }),
        doc({ documentId: 'f', pathname: 'docs/f' }), // not verified
      ],
      opts({ verifiedFirst: new Set(['docs/a', 'docs/b', 'docs/c', 'docs/d', 'docs/e']) }),
    );
    expect(plan.clear.map((c) => c.documentId)).toEqual(['a', 'b', 'c']);
    expect(plan.bytes).toBe(700);
    expect(plan.bookings).toBe(2);
    expect(plan.keep).toEqual(
      expect.arrayContaining([
        { reason: 'signed agreement (always kept)', count: 1 },
        { reason: 'rental not finished', count: 1 },
        { reason: 'not saved in the backup folder', count: 1 },
      ]),
    );
  });

  it('plans nothing when nothing has been verified', () => {
    const plan = planClear([doc(), doc({ documentId: 'x', pathname: 'docs/x' })], opts({ verifiedFirst: new Set() }));
    expect(plan.clear).toEqual([]);
    expect(plan.bytes).toBe(0);
  });

  it('never plans a file that fails any single test, whatever else passes (property)', () => {
    const base = doc();
    const breakers: Array<Partial<ClearCandidate>> = [
      { kind: 'SIGNED_CONTRACT' }, { stage: 'RETURNED' }, { overdue: true }, { needsReview: true },
      { completedAt: new Date('2026-12-20T00:00:00Z') }, { deletedAt: NOW }, { bookingId: null },
    ];
    for (const b of breakers) expect(planClear([{ ...base, ...b }], opts()).clear).toEqual([]);
  });
});
