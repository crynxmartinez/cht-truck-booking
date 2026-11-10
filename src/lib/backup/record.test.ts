import { describe, expect, it } from 'vitest';
import { buildRecord, csvRow, recordFingerprint, CSV_HEADERS, type BookingSource } from './record';
import { sampleBooking } from './record.fixture';

const base = sampleBooking;
const at = (s: string) => new Date(s);

describe('buildRecord', () => {
  it('gathers the booking in plain words', () => {
    const r = buildRecord(base());
    expect(r.booking).toMatchObject({ renter: 'Sample Renter', pickupDate: '2026-11-20', returnDate: '2026-11-22', truck: 'A', stage: 'COMPLETED' });
  });

  it('never contains a secret signing or checklist link token, or a signature image', () => {
    const src = base() as unknown as Record<string, unknown>;
    // even if the source row carried them, they must not come through
    (src.contracts as Array<Record<string, unknown>>)[0].token = 'SECRET-SIGN-TOKEN';
    (src.contracts as Array<Record<string, unknown>>)[0].signatureData = 'data:image/png;base64,SIGNATURE';
    (src.checklists as Array<Record<string, unknown>>)[0].token = 'SECRET-CHECKLIST-TOKEN';
    const json = JSON.stringify(buildRecord(src as unknown as BookingSource));
    expect(json).not.toContain('SECRET-SIGN-TOKEN');
    expect(json).not.toContain('SECRET-CHECKLIST-TOKEN');
    expect(json).not.toContain('SIGNATURE');
  });

  it('keeps who signed, when and from where', () => {
    const c = buildRecord(base()).contracts[0];
    expect(c).toMatchObject({ signerName: 'Sample Renter', signedAt: '2026-11-01T10:05:00.000Z', approvedBy: 'Main Admin', ipAddress: '203.0.113.9' });
  });

  it('lists every file once, marks removed ones, and adds PDFs stored only by path', () => {
    const files = buildRecord(base()).files;
    // d3 and the contract share a pathname: one entry only. The checklist report is added.
    expect(files.map((f) => f.pathname).sort()).toEqual(['checklists/c1.pdf', 'contracts/k1.pdf', 'docs/d1.webp', 'docs/d2.webp']);
    expect(files.find((f) => f.pathname === 'docs/d2.webp')?.removed).toBe(true);
    expect(files.find((f) => f.pathname === 'docs/d1.webp')?.label).toBe('Driver license (booking)');
    expect(files.find((f) => f.pathname === 'checklists/c1.pdf')?.label).toBe('Pickup checklist report');
  });

  it('puts messages and events in time order', () => {
    const r = buildRecord(base());
    expect(r.messages.map((m) => m.template)).toEqual(['contract_to_sign', 'thank_you']);
    expect(r.events.map((e) => e.type)).toEqual(['created', 'stage_change']);
  });
});

describe('recordFingerprint', () => {
  it('is the same for the same record and changes when anything is added', () => {
    const a = buildRecord(base());
    const b = buildRecord(base());
    expect(recordFingerprint(a)).toBe(recordFingerprint(b));
    const more = base();
    more.events.push({ type: 'note', detail: 'new', actor: 'ops', createdAt: at('2026-12-01T00:00:00Z') });
    expect(recordFingerprint(buildRecord(more))).not.toBe(recordFingerprint(a));
  });
});

describe('csvRow', () => {
  it('has one value per header', () => {
    expect(csvRow(buildRecord(base()), 'folder').length).toBe(CSV_HEADERS.length);
  });

  it('carries the signing and approval dates', () => {
    const row = csvRow(buildRecord(base()), 'folder');
    expect(row[CSV_HEADERS.indexOf('Signed by renter')]).toBe('2026-11-01');
    expect(row[CSV_HEADERS.indexOf('Approved')]).toBe('2026-11-02');
  });
});
