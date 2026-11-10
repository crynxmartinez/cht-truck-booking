import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { BackupRecord } from './record';

/**
 * The record PDF: something a person can read, forward and file. It lists the
 * licence and insurance files by name but never shows them, so it is safe to
 * send on. Truck photos are shown (they are what settles a damage question).
 *
 * The built-in PDF fonts cover Western European letters only. Anything else
 * (other alphabets, emoji) is shown as "?" in the PDF, and the page says so;
 * record.json always has the exact text.
 */

const A4 = { w: 595.28, h: 841.89 };
const M = 48;
const INK = rgb(0.09, 0.094, 0.102);
const MUTED = rgb(0.42, 0.43, 0.45);
const RED = rgb(0.839, 0, 0.109);
const RULE = rgb(0.85, 0.86, 0.87);

export type RecordPhoto = { label: string; jpeg: Uint8Array };

export type RenderOptions = {
  /** Truck photos, already shrunk to JPEG. */
  photos: RecordPhoto[];
  /** Where each file sits in the booking's folder, by cloud path. Shown in the Files list. */
  fileNames: Record<string, string>;
  generatedAt: Date;
  /** The PDF was made from the live system, not from a saved folder: files are in cloud storage, not beside it. */
  cloudOnly?: boolean;
  /** Extra exact strings to hide, such as the truck's current lockbox code. */
  hide?: string[];
};

/** True when the font can draw the character. */
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const drawable = (ch: string) => {
  const c = ch.codePointAt(0)!;
  return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN_ANSI_EXTRA.has(ch);
};

/** Text the standard fonts can draw, plus whether anything had to be replaced. */
export function toDrawable(input: string): { text: string; lossy: boolean } {
  let lossy = false;
  const out: string[] = [];
  for (const ch of input.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').normalize('NFC')) {
    if (ch === '\n') out.push(ch);
    else if (drawable(ch)) out.push(ch);
    else {
      lossy = true;
      out.push('?');
    }
  }
  return { text: out.join(''), lossy };
}

/**
 * Message texts can carry the truck's lockbox code, and this PDF is meant to be
 * forwarded. The code is hidden here; record.json keeps the exact text.
 */
export function hideLockboxCode(text: string, extra: readonly string[] = []): string {
  // First the codes we know: every truck's current code, wherever and however it is worded.
  // Longest first, and before the pattern below, so a code like 12-34 is hidden whole.
  let out = text;
  for (const secret of [...extra].map((s) => s.trim()).filter((s) => s.length >= 3).sort((a, b) => b.length - a.length)) {
    out = out.split(secret).join('[hidden]');
  }
  // Then the pattern: the first token with a digit in it, soon after the words lockbox / key box,
  // or "access / door / gate / entry code".
  const token = String.raw`\b([A-Za-z]*\d[A-Za-z0-9-]*)\b`;
  // [\s\S] so a code on the next line is caught too.
  out = out.replace(new RegExp(String.raw`((?:lock\s?box|key\s?box)[\s\S]{0,45}?)${token}`, 'gi'), '$1[hidden]');
  out = out.replace(new RegExp(String.raw`((?:access|door|gate|entry|security|box)\s+(?:code|pin|number)[\s\S]{0,30}?)${token}`, 'gi'), '$1[hidden]');
  return out;
}

class Flow {
  doc!: PDFDocument;
  page!: PDFPage;
  y = 0;
  regular!: PDFFont;
  bold!: PDFFont;
  lossy = false;

  async init() {
    this.doc = await PDFDocument.create();
    this.regular = await this.doc.embedFont(StandardFonts.Helvetica);
    this.bold = await this.doc.embedFont(StandardFonts.HelveticaBold);
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage([A4.w, A4.h]);
    this.y = A4.h - M;
  }

  ensure(h: number) {
    if (this.y - h < M) this.newPage();
  }

  draw(s: string): string {
    const r = toDrawable(s);
    if (r.lossy) this.lossy = true;
    return r.text;
  }

  private wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const lines: string[] = [];
    for (const para of this.draw(text).split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        let w = word;
        // a single very long word (a URL) is cut so it cannot run off the page
        while (font.widthOfTextAtSize(w, size) > width && w.length > 1) {
          let cut = w.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > width) cut--;
          if (line) { lines.push(line); line = ''; }
          lines.push(w.slice(0, cut));
          w = w.slice(cut);
        }
        const attempt = line ? `${line} ${w}` : w;
        if (font.widthOfTextAtSize(attempt, size) <= width) line = attempt;
        else { lines.push(line); line = w; }
      }
      lines.push(line);
    }
    return lines;
  }

  text(s: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; indent?: number; gap?: number } = {}) {
    const size = opts.size ?? 9.5;
    const font = opts.bold ? this.bold : this.regular;
    const x = M + (opts.indent ?? 0);
    const lead = size * 1.35;
    for (const line of this.wrap(s, font, size, A4.w - M - x)) {
      this.ensure(lead);
      this.y -= lead;
      if (line) this.page.drawText(line, { x, y: this.y, size, font, color: opts.color ?? INK });
    }
    this.y -= opts.gap ?? 0;
  }

  heading(s: string) {
    this.ensure(40);
    this.y -= 10;
    this.text(s, { size: 12, bold: true, color: RED, gap: 2 });
    this.page.drawLine({ start: { x: M, y: this.y + 1 }, end: { x: A4.w - M, y: this.y + 1 }, thickness: 0.6, color: RULE });
    this.y -= 4;
  }

  row(label: string, value: string | null | undefined) {
    if (value === null || value === undefined || value === '') return;
    this.ensure(14);
    const l = this.draw(label);
    this.page.drawText(l, { x: M, y: this.y - 12, size: 9, font: this.bold, color: MUTED });
    const x = M + 120;
    const lines = this.wrap(value, this.regular, 9.5, A4.w - M - x);
    for (const line of lines) {
      this.ensure(13);
      this.y -= 13;
      if (line) this.page.drawText(line, { x, y: this.y, size: 9.5, font: this.regular, color: INK });
    }
  }
}

const stamp = (s: unknown) => (typeof s === 'string' ? s.replace('T', ' ').replace(/\.\d+Z$/, ' UTC') : '');
const yn = (b: unknown) => (b ? 'Yes' : 'No');
const size = (n: number | null) => (n === null ? '' : n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export async function renderRecordPdf(r: BackupRecord, opts: RenderOptions): Promise<{ bytes: Uint8Array; lossy: boolean }> {
  const f = new Flow();
  await f.init();
  /** Free text from the record: lockbox codes hidden wherever it appears. */
  const h = (s: unknown) => hideLockboxCode(String(s ?? ''), opts.hide);

  f.text('Booking record', { size: 20, bold: true, gap: 2 });
  f.text(`${r.reference}  ·  ${r.booking.renter}`, { size: 11, color: MUTED, gap: 2 });
  f.text(`Saved ${stamp(opts.generatedAt.toISOString())}. This is a copy of the record kept in the truck rental system.`, { size: 8.5, color: MUTED });

  f.heading('Booking');
  f.row('Reference', r.reference);
  f.row('Stage', r.booking.stage.replace(/_/g, ' ').toLowerCase());
  f.row('Pickup', r.booking.pickupDate);
  f.row('Return', r.booking.returnDate);
  f.row('Truck', r.booking.truck ? `Truck ${r.booking.truck}${r.booking.truckPlate ? ` (plate ${r.booking.truckPlate})` : ''}` : 'None assigned');
  f.row('Booked', stamp(r.booking.createdAt));
  f.row('Completed', stamp(r.booking.completedAt));
  f.row('Cancelled', stamp(r.booking.cancelledAt));
  f.row('Cancel reason', r.booking.cancelledReason ? h(r.booking.cancelledReason) : null);
  f.row('Review note', r.booking.reviewNote ? h(r.booking.reviewNote) : null);

  f.heading('Renter');
  f.row('Name', r.booking.renter);
  f.row('Email', r.booking.email);
  f.row('Phone', r.booking.phone);

  const d = r.additionalDriver;
  if (d) {
    f.heading('Additional driver');
    f.row('Name', d.name);
    f.row('Email', d.email);
    f.row('Phone', d.phone);
    f.row('Address', [d.street, d.city, d.state, d.zip].filter(Boolean).join(', '));
    f.row('Employer', [d.employer, d.employerPhone].filter(Boolean).join(' · '));
    f.row('Licence number', d.licenseNo);
    f.row('Date of birth', d.dob);
    f.row('Insurance', [d.insuranceCarrier, d.insurancePolicyNo, d.insurancePhone].filter(Boolean).join(' · '));
  }

  f.heading('Agreements');
  if (r.contracts.length === 0) f.text('None on record.', { color: MUTED });
  for (const c of r.contracts) {
    f.text(c.type === 'RENTAL_AGREEMENT' ? 'Rental agreement' : 'Additional driver agreement', { bold: true, gap: 1 });
    f.row('Status', String(c.status).toLowerCase());
    f.row('Signed by', [c.signerName, c.signerEmail].filter(Boolean).join(' · '));
    f.row('Signed', stamp(c.signedAt));
    f.row('From', [c.ipAddress, c.userAgent].filter(Boolean).join(' · '));
    f.row('Approved by', c.approvedBy ? `${c.approvedBy}  (${stamp(c.approvedAt)})` : '');
    f.row('Acknowledged', `Tolls: ${yn(c.tollAcknowledged)}   Fuel: ${yn(c.gasAcknowledged)}   Dolly: ${yn(c.dollyAcknowledged)}`);
    f.row('Wording version', [c.termsVersion, c.termsHash ? String(c.termsHash).slice(0, 16) : ''].filter(Boolean).join(' · '));
    f.y -= 4;
  }

  f.heading('Checklists');
  if (r.checklists.length === 0) f.text('None on record.', { color: MUTED });
  for (const k of r.checklists) {
    f.text(k.phase === 'PICKUP' ? 'Pickup' : 'Return', { bold: true, gap: 1 });
    f.row('Time reported', k.reportedTime as string | null);
    f.row('Submitted', stamp(k.submittedAt));
    f.row('Notes', k.notes ? h(k.notes) : null);
    f.row('Approved by', k.approvedBy ? `${k.approvedBy}  (${stamp(k.approvedAt)})` : '');
    f.row('Completed by', [k.completionSource, k.completedBy].filter(Boolean).join(' · '));
    f.row('Override reason', k.overrideReason ? h(k.overrideReason) : null);
    f.y -= 4;
  }

  f.heading('Files');
  f.text(
    opts.cloudOnly
      ? 'Licence and insurance photos are listed here but not shown.'
      : 'Licence and insurance photos are listed here but not shown. The originals are in the files folder next to this record.',
    { size: 8.5, color: MUTED, gap: 3 },
  );
  if (r.files.length === 0) f.text('No files.', { color: MUTED });
  for (const file of r.files) {
    const where = file.removed ? 'removed from cloud storage' : opts.fileNames[file.pathname] ?? (opts.cloudOnly ? 'in cloud storage' : 'not saved');
    f.text(`${file.label}  ·  ${size(file.bytes)}  ·  ${where}`, { indent: 6 });
  }

  if (opts.photos.length) {
    f.heading('Truck photos');
    const W = (A4.w - 2 * M - 12) / 2;
    // Embed first, so the height of both photos in a row is known before either is drawn.
    const ready: Array<{ label: string; img: Awaited<ReturnType<typeof f.doc.embedJpg>>; w: number; h: number }> = [];
    for (const p of opts.photos) {
      try {
        const img = await f.doc.embedJpg(p.jpeg);
        const ph = Math.min(W * (img.height / img.width), 260);
        ready.push({ label: p.label, img, h: ph, w: ph === 260 ? 260 * (img.width / img.height) : W });
      } catch {
        f.text(`${p.label}: could not be shown here.`, { color: MUTED });
      }
    }
    for (let i = 0; i < ready.length; i += 2) {
      const pair = ready.slice(i, i + 2);
      const rowH = Math.max(...pair.map((p) => p.h)) + 16;
      f.ensure(rowH + 4);
      pair.forEach((p, col) => {
        const x = M + col * (W + 12);
        f.page.drawImage(p.img, { x, y: f.y - p.h, width: p.w, height: p.h });
        f.page.drawText(f.draw(p.label).slice(0, 60), { x, y: f.y - p.h - 9, size: 7.5, font: f.regular, color: MUTED });
      });
      f.y -= rowH;
    }
  }

  f.heading('Messages sent');
  f.text('Lockbox codes and secret links are hidden in this PDF. record.json hides the links too, and keeps the rest exactly as sent.', { size: 8.5, color: MUTED, gap: 3 });
  if (r.messages.length === 0) f.text('None.', { color: MUTED });
  for (const m of r.messages) {
    f.text(`${stamp(m.at)}  ·  ${String(m.channel).toLowerCase()}  ·  ${String(m.template).replace(/_/g, ' ')}  ·  ${m.template === 'inbound_reply' ? 'received from the renter' : `to ${m.to ?? 'unknown'}`}  ·  ${String(m.status).toLowerCase()}`, { bold: true, size: 8.5 });
    if (m.subject) f.text(`Subject: ${h(m.subject)}`, { indent: 6, size: 8.5 });
    if (m.body) f.text(h(m.body), { indent: 6, size: 8.5 });
    if (m.error) f.text(`Did not go out: ${h(m.error)}`, { indent: 6, size: 8.5, color: RED });
    f.y -= 3;
  }

  f.heading('Activity');
  if (r.events.length === 0) f.text('None.', { color: MUTED });
  for (const e of r.events) {
    f.text(`${stamp(e.at)}  ·  ${e.actor ?? ''}  ·  ${String(e.type).replace(/_/g, ' ')}${e.detail ? `  ·  ${h(e.detail)}` : ''}`, { size: 8.5 });
  }

  if (f.lossy) {
    f.y -= 8;
    f.text('Some characters (other alphabets or emoji) could not be shown in this PDF and appear as "?". record.json has the exact text.', { size: 8.5, color: MUTED });
  }

  // page numbers
  const pages = f.doc.getPages();
  pages.forEach((pg, i) => {
    pg.drawText(`${r.reference}  ·  page ${i + 1} of ${pages.length}`, { x: M, y: 24, size: 7.5, font: f.regular, color: MUTED });
  });

  return { bytes: await f.doc.save(), lossy: f.lossy };
}
