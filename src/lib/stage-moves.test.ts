import { describe, expect, it } from 'vitest';
import { Stage } from '@prisma/client';
import { ackCovers, checkMove, isAck, isBoardStage, type MoveFacts } from './stage-moves';

const base: MoveFacts = {
  from: Stage.NEW_BOOKING,
  to: Stage.CONTRACT_SENT,
  pickupIso: '2026-11-20',
  returnIso: '2026-11-22',
  todayIso: '2026-11-10',
  approvalComplete: true,
};
const move = (over: Partial<MoveFacts>) => checkMove({ ...base, ...over });

describe('checkMove', () => {
  it('lets an ordinary forward move through', () => {
    expect(move({ from: Stage.NEW_BOOKING, to: Stage.CONTRACT_SENT })).toEqual({ level: 'ok' });
    expect(move({ from: Stage.CONFIRMED, to: Stage.PICKUP_DAY })).toEqual({ level: 'ok' });
  });

  it('does nothing for a drop on the same column', () => {
    expect(move({ from: Stage.CONFIRMED, to: Stage.CONFIRMED, approvalComplete: false })).toEqual({ level: 'ok' });
  });

  it.each([Stage.CONFIRMED, Stage.PICKUP_DAY, Stage.IN_USE, Stage.RETURNED])(
    'refuses %s while the agreement is not fully approved',
    (to) => {
      const v = move({ from: Stage.AWAITING_APPROVAL, to, approvalComplete: false });
      expect(v.level).toBe('blocked');
      expect(v.level === 'blocked' && v.reasons[0]).toMatch(/not fully signed and approved/);
    },
  );

  it('allows the same moves once it is approved', () => {
    expect(move({ from: Stage.AWAITING_APPROVAL, to: Stage.CONFIRMED, approvalComplete: true })).toEqual({ level: 'ok' });
  });

  it('does not block early stages, or completing, for want of approval', () => {
    expect(move({ from: Stage.NEW_BOOKING, to: Stage.ADDITIONAL_DRIVER, approvalComplete: false }).level).toBe('ok');
    expect(move({ from: Stage.RETURNED, to: Stage.COMPLETED, approvalComplete: false }).level).toBe('confirm');
  });

  it('asks before completing, and says what completing does', () => {
    const v = move({ from: Stage.RETURNED, to: Stage.COMPLETED });
    expect(v).toMatchObject({ level: 'confirm' });
    expect(v.level === 'confirm' && v.reasons.join(' ')).toMatch(/frees the truck/);
  });

  it('asks before reopening a finished booking, and says the deletion clock stops', () => {
    const v = move({ from: Stage.COMPLETED, to: Stage.RETURNED });
    expect(v.level).toBe('confirm');
    expect(v.level === 'confirm' && v.reasons.join(' ')).toMatch(/clock .* is stopped/);
  });

  it('asks before moving back a step', () => {
    const v = move({ from: Stage.IN_USE, to: Stage.PICKUP_DAY });
    expect(v).toMatchObject({ level: 'confirm', reasons: ['This moves the booking back a step.'] });
  });

  it('warns about the lockbox text when pickup is today', () => {
    const v = move({ from: Stage.AWAITING_APPROVAL, to: Stage.CONFIRMED, pickupIso: '2026-11-10' });
    expect(v.level).toBe('confirm');
    expect(v.level === 'confirm' && v.reasons.join(' ')).toMatch(/Pickup is today/);
  });

  it('does not warn about pickup on other days', () => {
    expect(move({ from: Stage.AWAITING_APPROVAL, to: Stage.CONFIRMED }).level).toBe('ok');
  });

  it('warns about the return text when it is due back today', () => {
    const v = move({ from: Stage.PICKUP_DAY, to: Stage.IN_USE, returnIso: '2026-11-10' });
    expect(v.level).toBe('confirm');
    expect(v.level === 'confirm' && v.reasons.join(' ')).toMatch(/due back today/);
  });

  it('keeps every reason when a move is both blocked and worth a warning', () => {
    const v = move({ from: Stage.AWAITING_APPROVAL, to: Stage.CONFIRMED, approvalComplete: false, pickupIso: '2026-11-10' });
    expect(v.level).toBe('blocked');
    expect(v.level === 'blocked' && v.reasons).toHaveLength(2);
  });
});

describe('ackCovers', () => {
  const ok = { level: 'ok' } as const;
  const confirm = { level: 'confirm', reasons: ['x'] } as const;
  const blocked = { level: 'blocked', reasons: ['x'] } as const;

  it('needs nothing for an ordinary move', () => {
    expect(ackCovers(ok, 'none')).toBe(true);
  });
  it('needs a yes to confirm', () => {
    expect(ackCovers(confirm, 'none')).toBe(false);
    expect(ackCovers(confirm, 'confirmed')).toBe(true);
    expect(ackCovers(confirm, 'override')).toBe(true);
  });
  it('needs an override for a refused move; a plain yes is not enough', () => {
    expect(ackCovers(blocked, 'none')).toBe(false);
    expect(ackCovers(blocked, 'confirmed')).toBe(false);
    expect(ackCovers(blocked, 'override')).toBe(true);
  });
});

describe('input guards', () => {
  it('knows the board columns, and that Cancelled is not one', () => {
    expect(isBoardStage('CONFIRMED')).toBe(true);
    expect(isBoardStage('CANCELLED')).toBe(false);
    expect(isBoardStage('nonsense')).toBe(false);
    expect(isBoardStage(undefined)).toBe(false);
  });
  it('only accepts the three agreement levels', () => {
    expect(isAck('override')).toBe(true);
    expect(isAck('yes')).toBe(false);
    expect(isAck(true)).toBe(false);
  });
});
