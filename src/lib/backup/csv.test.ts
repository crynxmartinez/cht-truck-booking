import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from './csv';

describe('csvCell', () => {
  it('leaves ordinary text alone', () => {
    expect(csvCell('Sample Renter')).toBe('Sample Renter');
    expect(csvCell(42)).toBe('42');
  });

  it('makes empty values empty', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it.each(['=1+1', '-5', '@SUM(A1)', '+1+1', '+12', '+1 (555) 1+1', '=HYPERLINK("http://evil","x")', '\t=1', '\r=1'])(
    'turns a possible formula into plain text: %j',
    (v) => {
      expect(csvCell(v).replace(/^"/, '').startsWith("'")).toBe(true);
    },
  );

  it('leaves a plain phone number as it is, so the Phone column is clean', () => {
    expect(csvCell('+19515550100')).toBe('+19515550100');
  });

  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });
});

describe('toCsv', () => {
  it('starts with a BOM, ends with a newline, and uses Windows line breaks', () => {
    const out = toCsv(['a', 'b'], [[1, 'x'], [2, 'y']]);
    expect(out.startsWith('﻿')).toBe(true);
    expect(out).toBe('﻿a,b\r\n1,x\r\n2,y\r\n');
  });

  it('keeps accents and other languages intact', () => {
    expect(toCsv(['n'], [['José'], ['李小龍']])).toContain('José');
  });
});
