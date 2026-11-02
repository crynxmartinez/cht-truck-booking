import { describe, expect, it } from 'vitest';
import { PAST_PAGE_SIZE, boardWhere, completedCutoff, pastOrder, pastWhere, parsePastParams } from './board-window';

const NOW = new Date('2026-11-02T18:00:00Z');
const DAY = 86_400_000;

describe('completedCutoff', () => {
  it('is the given number of days before now', () => {
    expect(completedCutoff(NOW, 14).getTime()).toBe(NOW.getTime() - 14 * DAY);
    expect(completedCutoff(NOW, 1).getTime()).toBe(NOW.getTime() - DAY);
  });
});

describe('boardWhere — what stays on the Board', () => {
  const cutoff = completedCutoff(NOW, 14);
  const where = boardWhere(cutoff) as { OR: Array<Record<string, unknown>> };

  it('always shows every stage that is still in progress', () => {
    const live = where.OR.find((c) => 'stage' in c && typeof c.stage === 'object' && 'in' in (c.stage as object));
    const stages = (live!.stage as { in: string[] }).in;
    for (const s of ['NEW_BOOKING', 'CONTRACT_SENT', 'ADDITIONAL_DRIVER', 'AWAITING_APPROVAL', 'CONFIRMED', 'PICKUP_DAY', 'IN_USE', 'RETURNED']) {
      expect(stages, s).toContain(s);
    }
  });

  it('does not list Completed or Cancelled among the stages that always show', () => {
    const live = where.OR[0].stage as { in: string[] };
    expect(live.in).not.toContain('COMPLETED');
    expect(live.in).not.toContain('CANCELLED');
  });

  it('shows a Completed rental only while it is recent', () => {
    const completed = where.OR[1] as { stage: string; OR: Array<Record<string, unknown>> };
    expect(completed.stage).toBe('COMPLETED');
    expect(completed.OR).toContainEqual({ completedAt: { gte: cutoff } });
  });

  it('falls back to the last-changed time for a Completed rental with no completion time, so it is not stuck forever', () => {
    const completed = where.OR[1] as { OR: Array<Record<string, unknown>> };
    expect(completed.OR).toContainEqual({ completedAt: null, updatedAt: { gte: cutoff } });
  });
});

describe('parsePastParams — what the Past rentals page was asked for', () => {
  it('defaults to everything, first page, no search', () => {
    expect(parsePastParams({})).toEqual({ q: '', show: 'all', page: 1 });
  });

  it('reads a search, a filter and a page number', () => {
    expect(parsePastParams({ q: '  Diana ', show: 'cancelled', page: '3' })).toEqual({ q: 'Diana', show: 'cancelled', page: 3 });
  });

  it('ignores a filter it does not know and a page that is not a positive whole number', () => {
    expect(parsePastParams({ show: 'everything', page: '-2' })).toMatchObject({ show: 'all', page: 1 });
    expect(parsePastParams({ page: 'abc' })).toMatchObject({ page: 1 });
    expect(parsePastParams({ page: '2.5' })).toMatchObject({ page: 1 });
  });

  it('takes the first value when a parameter is repeated, and caps the search length', () => {
    expect(parsePastParams({ q: ['one', 'two'] }).q).toBe('one');
    expect(parsePastParams({ q: 'x'.repeat(500) }).q).toHaveLength(100);
  });
});

describe('pastWhere', () => {
  it('only ever lists rentals that are over', () => {
    for (const show of ['all', 'completed', 'cancelled'] as const) {
      const w = pastWhere({ q: '', show, page: 1 }) as { AND: Array<{ stage?: { in: string[] } }> };
      const stages = w.AND[0].stage!.in;
      for (const s of stages) expect(['COMPLETED', 'CANCELLED']).toContain(s);
    }
  });

  it('narrows to one kind when asked', () => {
    const c = pastWhere({ q: '', show: 'completed', page: 1 }) as { AND: Array<{ stage?: { in: string[] } }> };
    expect(c.AND[0].stage!.in).toEqual(['COMPLETED']);
    const x = pastWhere({ q: '', show: 'cancelled', page: 1 }) as { AND: Array<{ stage?: { in: string[] } }> };
    expect(x.AND[0].stage!.in).toEqual(['CANCELLED']);
  });

  it('adds no text condition without a search', () => {
    const w = pastWhere({ q: '', show: 'all', page: 1 }) as { AND: unknown[] };
    expect(w.AND).toHaveLength(1);
  });

  it('searches name, email, phone and reference, ignoring case', () => {
    const w = pastWhere({ q: 'gomez', show: 'all', page: 1 }) as { AND: Array<{ OR?: Array<Record<string, { contains: string; mode: string }>> }> };
    const fields = w.AND[1].OR!.flatMap((c) => Object.keys(c));
    expect(fields.sort()).toEqual(['email', 'firstName', 'lastName', 'phone', 'reference']);
    for (const c of w.AND[1].OR!) {
      const v = Object.values(c)[0];
      expect(v).toEqual({ contains: 'gomez', mode: 'insensitive' });
    }
  });
});

describe('paging', () => {
  it('lists the newest first', () => {
    expect(pastOrder()).toEqual([{ updatedAt: 'desc' }, { createdAt: 'desc' }]);
  });

  it('uses a page size that is not tiny and not unbounded', () => {
    expect(PAST_PAGE_SIZE).toBeGreaterThanOrEqual(25);
    expect(PAST_PAGE_SIZE).toBeLessThanOrEqual(100);
  });
});
