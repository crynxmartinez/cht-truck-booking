import { describe, expect, it } from 'vitest';
import { distinctRenters, renterWhere } from './renter-search';

type Where = { AND: Array<{ OR: Array<Record<string, { contains: string; mode: string }>> }> } | { phone: { contains: string } };

describe('renterWhere — turning what is typed into a search', () => {
  it('searches nothing for fewer than three characters, so one keystroke does not query the whole list', () => {
    expect(renterWhere('')).toBeNull();
    expect(renterWhere('  ')).toBeNull();
    expect(renterWhere('Vi')).toBeNull();
  });

  it('searches name, email and phone for one word, ignoring case', () => {
    const w = renterWhere('vic') as Where;
    expect('AND' in w).toBe(true);
    if ('AND' in w) {
      expect(w.AND).toHaveLength(1);
      const fields = w.AND[0].OR.flatMap((c) => Object.keys(c)).sort();
      expect(fields).toEqual(['email', 'firstName', 'lastName', 'phone']);
      for (const c of w.AND[0].OR) expect(Object.values(c)[0]).toEqual({ contains: 'vic', mode: 'insensitive' });
    }
  });

  it('needs every word to match, so a full name narrows the list', () => {
    const w = renterWhere('Victor Barroso') as Where;
    if ('AND' in w) expect(w.AND).toHaveLength(2);
    else throw new Error('expected a word search');
  });

  it('treats a typed phone number as digits, however it is spaced', () => {
    expect(renterWhere('(562) 556-8184')).toEqual({ phone: { contains: '5625568184' } });
    expect(renterWhere('562 556 8184')).toEqual({ phone: { contains: '5625568184' } });
  });

  it('does not treat a short run of digits as a phone number', () => {
    expect(renterWhere('555')).toBeNull();
  });

  it('only looks at the first few words of a long entry', () => {
    const w = renterWhere('a1 b2 c3 d4 e5 f6 g7') as Where;
    if ('AND' in w) expect(w.AND.length).toBeLessThanOrEqual(4);
  });
});

describe('distinctRenters — one suggestion per person, newest first', () => {
  const row = (firstName: string, lastName: string, email: string, phone = '+15555550100') => ({ firstName, lastName, email, phone });

  it('keeps the first (newest) row for each email and drops repeats', () => {
    const out = distinctRenters([row('Ana', 'Gomez', 'ana@x.co', '+1111'), row('Ana', 'Gomez', 'ANA@x.co', '+2222'), row('Bo', 'Li', 'bo@x.co')]);
    expect(out).toEqual([
      { name: 'Ana Gomez', email: 'ana@x.co', phone: '+1111' },
      { name: 'Bo Li', email: 'bo@x.co', phone: '+15555550100' },
    ]);
  });

  it('stops at the limit', () => {
    const rows = Array.from({ length: 12 }, (_, i) => row('P', String(i), `p${i}@x.co`));
    expect(distinctRenters(rows)).toHaveLength(5);
    expect(distinctRenters(rows, 3)).toHaveLength(3);
  });

  it('writes a name with no last name cleanly', () => {
    expect(distinctRenters([row('Madonna', '', 'm@x.co')])[0].name).toBe('Madonna');
  });

  it('copes with nothing', () => {
    expect(distinctRenters([])).toEqual([]);
  });
});
