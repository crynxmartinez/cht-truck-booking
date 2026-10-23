import { describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({ prisma: {} }));

import { HOLDING_STAGES } from './availability';
import { OVERLAP_CONSTRAINT, OVERLAP_GUARD_SQL, isOverlapViolation } from './overlap-guard';

describe('isOverlapViolation', () => {
  it('recognises the constraint by name', () => {
    expect(isOverlapViolation(new Error(`violates exclusion constraint "${OVERLAP_CONSTRAINT}"`))).toBe(true);
  });

  it('recognises the Postgres code, however Prisma wraps it', () => {
    expect(isOverlapViolation({ code: '23P01' })).toBe(true);
    expect(isOverlapViolation({ meta: { code: '23P01' } })).toBe(true);
    expect(isOverlapViolation(new Error('conflicting key value violates exclusion constraint "x"'))).toBe(true);
  });

  it.each([new Error('connection reset'), null, undefined, 'boom', 42, {}])('is false for %s', (e) => {
    expect(isOverlapViolation(e)).toBe(false);
  });
});

describe('OVERLAP_GUARD_SQL', () => {
  it('is an exclusion constraint on the right columns', () => {
    expect(OVERLAP_GUARD_SQL).toContain('EXCLUDE USING gist');
    expect(OVERLAP_GUARD_SQL).toContain(OVERLAP_CONSTRAINT);
    expect(OVERLAP_GUARD_SQL).toContain('"truckId" WITH =');
    expect(OVERLAP_GUARD_SQL).toContain(`daterange("blockStart", "blockEnd", '[]') WITH &&`);
  });

  it('guards exactly the stages the app treats as holding a truck, so the two cannot drift', () => {
    const listed = [...OVERLAP_GUARD_SQL.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort();
    expect(listed).toEqual([...HOLDING_STAGES].map(String).sort());
  });
});
