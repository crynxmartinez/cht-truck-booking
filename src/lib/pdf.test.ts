import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildContractPdf, type ContractPdfInput } from './pdf';

const base: ContractPdfInput = {
  type: 'RENTAL_AGREEMENT',
  reference: 'CHT-TEST',
  truck: { code: 'A', plate: '0000000', year: 2020 },
  pickupDate: '2026-12-10',
  returnDate: '2026-12-12',
  fields: { clientName: 'Sample Renter' },
  signerName: 'Sample Renter',
  initials: 'SR',
  tollAcknowledged: true,
  gasAcknowledged: true,
  dollyAcknowledged: true,
  signedAt: new Date('2026-11-04T18:00:00Z'),
  termsHash: 'abc123',
};

/**
 * The words printed on the pages. pdf-lib compresses page content and writes
 * text as hex strings, so this inflates every stream and decodes what is shown.
 */
async function pageText(input: ContractPdfInput): Promise<string> {
  const raw = Buffer.from(await buildContractPdf(input)).toString('latin1');
  const pieces: string[] = [];
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1');
    } catch {
      continue; // not a page stream (an image or a font)
    }
    for (const hex of content.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
      pieces.push(Buffer.from(hex[1], 'hex').toString('latin1'));
    }
    for (const lit of content.matchAll(/\(((?:\.|[^\)])*)\)\s*Tj/g)) pieces.push(lit[1]);
  }
  return pieces.join('\n');
}

const count = (text: string, word: string) => text.split(word).length - 1;

describe('the signed agreement PDF', () => {
  it('prints the tolls, fuel and dolly sections with their agreements shown as ticked', async () => {
    const text = await pageText(base);
    expect(text).toContain('TOLLS');
    expect(text).toContain('FUEL');
    expect(text).toContain('DOLLY');
    expect(text).toContain('Agreed to return the truck with at least the fuel it had at pickup.');
    expect(text).toContain('Agreed to return the dolly');
    expect(count(text, 'NOT AGREED')).toBe(0);
  });

  it('prints the wording of the fuel and dolly clauses, not just their titles', async () => {
    const text = await pageText(base);
    expect(text).toMatch(/fuel shown on the pickup checklist/);
    expect(text).toMatch(/If a dolly is provided with the truck/);
  });

  it('shows a clause as NOT AGREED when it was not acknowledged, rather than quietly printing it ticked', async () => {
    expect(count(await pageText({ ...base, gasAcknowledged: false }), 'NOT AGREED')).toBe(1);
    expect(count(await pageText({ ...base, dollyAcknowledged: false }), 'NOT AGREED')).toBe(1);
    expect(count(await pageText({ ...base, tollAcknowledged: false }), 'NOT AGREED')).toBe(1);
  });

  it('treats an older agreement with no fuel or dolly answer as not agreed, since they never were', async () => {
    const old: ContractPdfInput = { ...base };
    delete old.gasAcknowledged;
    delete old.dollyAcknowledged;
    expect(count(await pageText(old), 'NOT AGREED')).toBe(2);
  });

  it('is a valid PDF', async () => {
    const bytes = await buildContractPdf(base);
    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe('%PDF-');
  });
});
