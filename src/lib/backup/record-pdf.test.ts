import { inflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { buildRecord } from './record';
import { sampleBooking } from './record.fixture';
import { hideLockboxCode, renderRecordPdf, toDrawable, type RenderOptions } from './record-pdf';

const opts = (over: Partial<RenderOptions> = {}): RenderOptions => ({
  photos: [],
  fileNames: { 'docs/d1.webp': 'files/driver_license-booking-d1.webp', 'contracts/k1.pdf': 'files/signed_contract-contract-k1.pdf' },
  generatedAt: new Date('2026-12-01T12:00:00Z'),
  ...over,
});

/** The words printed on the pages (pdf-lib compresses page content and writes text as hex). */
function pageText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString('latin1');
  const pieces: string[] = [];
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1');
    } catch {
      continue;
    }
    for (const hex of content.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) pieces.push(Buffer.from(hex[1], 'hex').toString('latin1'));
    for (const lit of content.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) pieces.push(lit[1]);
  }
  return pieces.join('\n');
}

describe('renderRecordPdf', () => {
  it('makes a real PDF a reader can open', async () => {
    const { bytes } = await renderRecordPdf(buildRecord(sampleBooking()), opts());
    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('says what the booking was, who signed, and what was sent', async () => {
    const { bytes } = await renderRecordPdf(buildRecord(sampleBooking()), opts());
    const text = pageText(bytes);
    expect(text).toContain('Booking record');
    expect(text).toContain('CHT-SAMPLE');
    expect(text).toContain('Sample Renter');
    expect(text).toContain('2026-11-20');
    expect(text).toContain('Main Admin'); // who approved
    expect(text).toContain('203.0.113.9'); // where it was signed from
    expect(text).toContain('Scratch on door'); // checklist note
    expect(text).toContain('Thanks!'); // message body
  });

  it('lists the licence file by name without showing it, and says what was removed', async () => {
    const { bytes } = await renderRecordPdf(buildRecord(sampleBooking()), opts());
    const text = pageText(bytes);
    expect(text).toContain('Driver license (booking)');
    expect(text).toContain('files/driver_license-booking-d1.webp');
    expect(text).toContain('removed from cloud storage'); // the cargo photo that was cleared
    // no image objects at all when no truck photos are passed in
    expect(Buffer.from(bytes).toString('latin1')).not.toContain('/Subtype /Image');
  });

  it('never contains a signing or checklist token or a signature image', async () => {
    const src = sampleBooking() as unknown as { contracts: Array<Record<string, unknown>> };
    src.contracts[0].token = 'SECRET-SIGN-TOKEN';
    src.contracts[0].signatureData = 'data:image/png;base64,SIGNATURE';
    const { bytes } = await renderRecordPdf(buildRecord(src as never), opts());
    expect(pageText(bytes)).not.toContain('SECRET-SIGN-TOKEN');
    expect(Buffer.from(bytes).toString('latin1')).not.toContain('SECRET-SIGN-TOKEN');
  });

  it('keeps a tall photo after a short one on the same page without running off it', async () => {
    const wide = await sharp({ create: { width: 800, height: 200, channels: 3, background: { r: 10, g: 120, b: 10 } } }).jpeg().toBuffer();
    const tall = await sharp({ create: { width: 200, height: 800, channels: 3, background: { r: 10, g: 10, b: 120 } } }).jpeg().toBuffer();
    const photos = Array.from({ length: 8 }, (_, i) => ({ label: `P${i}`, jpeg: i % 2 ? tall : wide }));
    const { bytes } = await renderRecordPdf(buildRecord(sampleBooking()), opts({ photos }));
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });

  it('shows truck photos when given them', async () => {
    const jpeg = await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 200, g: 50, b: 50 } } }).jpeg().toBuffer();
    const { bytes } = await renderRecordPdf(buildRecord(sampleBooking()), opts({ photos: [{ label: 'Cargo photo (pickup)', jpeg }, { label: 'Exterior (pickup)', jpeg }, { label: 'Third', jpeg }] }));
    expect(Buffer.from(bytes).toString('latin1')).toContain('/Subtype /Image');
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('survives a photo it cannot read', async () => {
    const { bytes } = await renderRecordPdf(buildRecord(sampleBooking()), opts({ photos: [{ label: 'Broken', jpeg: new Uint8Array([1, 2, 3]) }] }));
    expect(pageText(bytes)).toContain('could not be shown here');
  });

  it('does not crash on names in other alphabets or emoji, and says so', async () => {
    const b = sampleBooking();
    b.firstName = '李小龍';
    b.lastName = 'O’Brien 😀';
    const { bytes, lossy } = await renderRecordPdf(buildRecord(b), opts());
    expect(lossy).toBe(true);
    expect(pageText(bytes)).toContain('record.json has the exact text');
  });

  it('keeps accented letters and typographic quotes', async () => {
    const b = sampleBooking();
    b.firstName = 'José';
    b.lastName = 'Núñez – “Sr.”';
    const { lossy } = await renderRecordPdf(buildRecord(b), opts());
    expect(lossy).toBe(false);
  });

  it('copes with a very long message and a very long unbroken word', async () => {
    const b = sampleBooking();
    b.messages[0].body = `${'word '.repeat(4000)}https://example.com/${'a'.repeat(400)}`;
    const { bytes } = await renderRecordPdf(buildRecord(b), opts());
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
  });

  it('handles a booking with nothing attached', async () => {
    const b = sampleBooking();
    Object.assign(b, { contracts: [], checklists: [], documents: [], messages: [], events: [], additionalDriver: null, truck: null });
    const { bytes } = await renderRecordPdf(buildRecord(b), opts());
    expect(pageText(bytes)).toContain('None on record.');
  });
});

describe('lockbox codes', () => {
  it('are hidden in the PDF text, in every wording the messages use', () => {
    expect(hideLockboxCode('Lockbox code: 4821')).toBe('Lockbox code: [hidden]');
    expect(hideLockboxCode('Truck A is ready. Lockbox code 4821, enjoy')).toBe('Truck A is ready. Lockbox code [hidden], enjoy');
    expect(hideLockboxCode('Lockbox code, in case you need it again: 4821')).toBe('Lockbox code, in case you need it again: [hidden]');
    expect(hideLockboxCode('LOCKBOX CODE: AB12')).toBe('LOCKBOX CODE: [hidden]');
  });

  it('hides the current code of the truck wherever it appears, however it is worded', () => {
    expect(hideLockboxCode('Use 90210 to open the box', ['90210'])).toBe('Use [hidden] to open the box');
    expect(hideLockboxCode('anything 90210 90210', ['90210'])).toBe('anything [hidden] [hidden]');
  });

  it('leaves ordinary text alone', () => {
    expect(hideLockboxCode('The lockbox is on the driver side window. Keys go back in the lockbox.')).toBe(
      'The lockbox is on the driver side window. Keys go back in the lockbox.',
    );
  });

  it('are hidden when the wording changed, when on the next line, and for odd codes', () => {
    expect(hideLockboxCode('Your access code is 4821')).toBe('Your access code is [hidden]');
    expect(hideLockboxCode('The box code: 4821')).toBe('The box code: [hidden]');
    expect(hideLockboxCode('Lockbox: 4821')).toBe('Lockbox: [hidden]');
    expect(hideLockboxCode('lock box 4821')).toBe('lock box [hidden]');
    expect(hideLockboxCode('Lockbox code:\n4821')).toBe('Lockbox code:\n[hidden]');
    // a code with a dash is hidden whole when the truck's codes are known, not left as "-34"
    expect(hideLockboxCode('Lockbox code 12-34 ok', ['12-34'])).toBe('Lockbox code [hidden] ok');
    expect(hideLockboxCode('Lockbox code 12-34 ok')).toBe('Lockbox code [hidden] ok');
  });

  it('hides every truck\'s code, not only the booking\'s own, so a swapped or changed code is covered', () => {
    expect(hideLockboxCode('Old truck was 7777, new is 8888', ['8888', '7777'])).toBe('Old truck was [hidden], new is [hidden]');
  });

  it('hides the code in notes, events and errors, not only message bodies', async () => {
    const b = sampleBooking();
    b.checklists[0].notes = 'renter says lockbox code 6543 did not work';
    b.events[0].detail = 'told renter door code 6543';
    b.messages[0].error = 'could not send: lockbox code 6543';
    b.reviewNote = 'box code 6543';
    const { bytes } = await renderRecordPdf(buildRecord(b), opts());
    expect(pageText(bytes)).not.toContain('6543');
  });

  it('staff alerts and their phone numbers and emails never reach the PDF', async () => {
    const b = sampleBooking();
    b.messages.push({ recipientKey: 'cmstaff123', template: 'staff_booking_received', channel: 'SMS', status: 'SENT', toAddress: '+15555550199', subject: null, body: 'Team alert text', error: null, sentAt: new Date('2026-11-02T00:00:00Z'), createdAt: new Date('2026-11-02T00:00:00Z') });
    const { bytes } = await renderRecordPdf(buildRecord(b), opts());
    const text = pageText(bytes);
    expect(text).not.toContain('5555550199');
    expect(text).not.toContain('Team alert text');
  });

  it('are not printed in the PDF', async () => {
    const b = sampleBooking();
    b.messages[0].body = 'Hi, Lockbox code: 4821. The lockbox is on the driver side.';
    const { bytes } = await renderRecordPdf(buildRecord(b), opts());
    const text = pageText(bytes);
    expect(text).not.toContain('4821');
    expect(text).toContain('[hidden]');
  });

  it('are kept exactly in the record data', () => {
    const b = sampleBooking();
    b.messages[0].body = 'Lockbox code: 4821';
    expect(JSON.stringify(buildRecord(b))).toContain('4821');
  });
});

describe('toDrawable', () => {
  it('replaces what the font cannot draw and reports it', () => {
    expect(toDrawable('a李b')).toEqual({ text: 'a?b', lossy: true });
  });
  it('leaves Western text alone', () => {
    expect(toDrawable('José – “ok” €5')).toEqual({ text: 'José – “ok” €5', lossy: false });
  });
});
