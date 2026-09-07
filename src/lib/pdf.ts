import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { config } from './config';
import {
  DAMAGE_WAIVER_NOTICE,
  TOLL_AGREEMENT,
  READ_AND_SIGN,
  RENTAL_CLAUSES,
  RENTAL_INTRO,
  TERMS_VERSION,
  WAIVER_CLAUSES,
  WAIVER_CLOSING,
  WAIVER_INTRO,
  WAIVER_TITLE,
} from './contract-terms';
import { formatLong, formatStamp } from './dates';

/**
 * Renders the finished agreement as a PDF: the data page, the rental terms and
 * the waiver, plus an audit block recording who signed from where and what
 * wording they saw. Attached to the confirmation email and shown on the CRM card.
 */

const A4 = { w: 595.28, h: 841.89 };
const M = 52; // margin
const RED = rgb(0.839, 0, 0.109);
const INK = rgb(0.09, 0.094, 0.102);
const MUTED = rgb(0.42, 0.43, 0.45);
const RULE = rgb(0.85, 0.86, 0.87);

export type ContractPdfInput = {
  type: 'RENTAL_AGREEMENT' | 'ADDITIONAL_DRIVER';
  reference: string;
  truck: { code: string; plate: string; year: number } | null;
  pickupDate: string;
  returnDate: string;
  fields: Record<string, string>;
  signerName: string;
  initials: string;
  tollAcknowledged: boolean;
  signatureDataUrl?: string | null;
  signedAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
  termsHash: string;
};

class Writer {
  doc!: PDFDocument;
  page!: PDFPage;
  y = 0;
  regular!: PDFFont;
  bold!: PDFFont;
  italic!: PDFFont;

  async init() {
    this.doc = await PDFDocument.create();
    this.regular = await this.doc.embedFont(StandardFonts.Helvetica);
    this.bold = await this.doc.embedFont(StandardFonts.HelveticaBold);
    this.italic = await this.doc.embedFont(StandardFonts.HelveticaOblique);
    this.newPage();
    return this;
  }

  newPage() {
    this.page = this.doc.addPage([A4.w, A4.h]);
    this.y = A4.h - M;
  }

  need(space: number) {
    if (this.y - space < M + 24) this.newPage();
  }

  text(
    s: string,
    opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; indent?: number; gap?: number } = {},
  ) {
    const size = opts.size ?? 9.5;
    const font = opts.font ?? this.regular;
    const color = opts.color ?? INK;
    const indent = opts.indent ?? 0;
    const width = A4.w - M * 2 - indent;
    const lines = wrap(s, font, size, width);

    for (const line of lines) {
      this.need(size + 3);
      this.page.drawText(line, { x: M + indent, y: this.y - size, size, font, color });
      this.y -= size + 3;
    }
    this.y -= opts.gap ?? 4;
  }

  rule(gap = 10) {
    this.need(gap + 2);
    this.page.drawLine({
      start: { x: M, y: this.y },
      end: { x: A4.w - M, y: this.y },
      thickness: 0.7,
      color: RULE,
    });
    this.y -= gap;
  }

  heading(s: string) {
    this.need(30);
    this.y -= 6;
    this.text(s, { size: 13, font: this.bold, gap: 8 });
  }

  /** Two-column label/value grid, like the paper form's data page. */
  pairs(rows: Array<[string, string]>) {
    const colW = (A4.w - M * 2) / 2;
    for (let i = 0; i < rows.length; i += 2) {
      this.need(28);
      const top = this.y;
      for (let c = 0; c < 2; c++) {
        const row = rows[i + c];
        if (!row) continue;
        const x = M + c * colW;
        this.page.drawText(row[0].toUpperCase(), { x, y: top - 8, size: 6.5, font: this.bold, color: MUTED });
        const val = row[1] || '—';
        const clipped = clip(val, this.regular, 9.5, colW - 14);
        this.page.drawText(clipped, { x, y: top - 21, size: 9.5, font: this.regular, color: INK });
      }
      this.y = top - 30;
    }
  }
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of String(text).split('\n')) {
    if (!para.trim()) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of para.split(/\s+/)) {
      const attempt = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(sanitise(attempt), size) <= maxWidth) {
        line = attempt;
      } else {
        if (line) out.push(sanitise(line));
        line = word;
      }
    }
    if (line) out.push(sanitise(line));
  }
  return out;
}

function clip(text: string, font: PDFFont, size: number, maxWidth: number): string {
  let s = sanitise(text);
  while (s.length > 1 && font.widthOfTextAtSize(s, size) > maxWidth) s = s.slice(0, -1);
  return s;
}

/** Standard-14 fonts are WinAnsi only; smart quotes and dashes would throw. */
function sanitise(s: string): string {
  return s
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
    .replace(/[^\x20-\x7E]/g, '');
}

export async function buildContractPdf(input: ContractPdfInput): Promise<Uint8Array> {
  const w = await new Writer().init();
  const f = input.fields;
  const isAdditional = input.type === 'ADDITIONAL_DRIVER';

  // ---------------------------------------------------------------- page 1
  w.page.drawText('TRUCK RENTAL AGREEMENT', { x: M, y: w.y - 12, size: 11, font: w.bold, color: INK });
  w.page.drawText('CORY HOME TEAM', { x: A4.w - M - 140, y: w.y - 12, size: 13, font: w.bold, color: RED });
  w.y -= 26;
  w.page.drawText(
    isAdditional ? 'Additional Authorized Driver Agreement' : 'Renter Agreement',
    { x: M, y: w.y - 9, size: 9, font: w.italic, color: MUTED },
  );
  w.page.drawText(`Ref ${input.reference}`, { x: A4.w - M - 90, y: w.y - 9, size: 8.5, font: w.regular, color: MUTED });
  w.y -= 20;
  w.rule(14);

  if (isAdditional) {
    w.pairs([
      ['Name (Additional Driver)', f.name ?? input.signerName],
      ['Phone', f.phone ?? ''],
      ['Employer / Company', f.employer ?? ''],
      ['Company phone', f.employerPhone ?? ''],
      ['Street address', f.street ?? ''],
      ['City', f.city ?? ''],
      ['State / Prov', f.state ?? ''],
      ['ZIP', f.zip ?? ''],
      ["Driver's licence no.", f.licenseNo ?? ''],
      ['Date of birth', f.dob ?? ''],
      ['Name of the person who booked the rental', f.mainRenterName ?? ''],
      ['', ''],
    ]);
  } else {
    w.pairs([
      ['Client name', f.clientName ?? input.signerName],
      ['Phone', f.phone ?? ''],
      ['Employer / Company', f.employer ?? ''],
      ['Company phone', f.employerPhone ?? ''],
      ['Old address', f.oldStreet ?? ''],
      ['City / State / ZIP', [f.oldCity, f.oldState, f.oldZip].filter(Boolean).join(', ')],
      ['New address', f.newStreet ?? ''],
      ['City / State / ZIP', [f.newCity, f.newState, f.newZip].filter(Boolean).join(', ')],
      ["Driver's licence no.", f.licenseNo ?? ''],
      ['Date of birth', f.dob ?? ''],
    ]);
  }

  w.rule(12);
  w.pairs([
    ['Truck no.', input.truck?.code ?? '—'],
    ['Pickup date', formatLong(input.pickupDate)],
    ['Licence plate', input.truck?.plate ?? '—'],
    ['Date due back', formatLong(input.returnDate)],
    ['Year', input.truck ? String(input.truck.year) : '—'],
    ['Pickup location', config.pickupAddress],
  ]);
  w.text('Note: Truck letter is located on the driver side front windshield.', {
    size: 8,
    font: w.italic,
    color: MUTED,
    gap: 6,
  });
  w.text('Note: Please return the gas level to the way it was received.', {
    size: 8,
    font: w.italic,
    color: MUTED,
    gap: 10,
  });

  w.rule(12);
  w.text('COMPREHENSIVE / COLLISION DAMAGE WAIVER', { size: 9, font: w.bold, gap: 5 });
  w.text(DAMAGE_WAIVER_NOTICE, { size: 8.5, color: MUTED, gap: 4 });
  w.text(`Initials: ${input.initials || '—'}`, { size: 9, font: w.bold, gap: 12 });

  w.pairs([
    ['Insurance carrier', f.insuranceCarrier ?? ''],
    ['Carrier contact number', f.insurancePhone ?? ''],
    ['Policy number', f.insurancePolicyNo ?? ''],
    ['', ''],
  ]);

  w.rule(12);
  w.text('TOLLS', { size: 9, font: w.bold, gap: 5 });
  w.text(TOLL_AGREEMENT, { size: 8.5, color: MUTED, gap: 6 });
  // Drawn as a real ticked box: a reader should see the consent, not read that
  // it happened.
  const boxY = w.y;
  w.page.drawRectangle({
    x: M, y: boxY - 10, width: 10, height: 10,
    borderColor: input.tollAcknowledged ? RED : RULE, borderWidth: 1,
  });
  if (input.tollAcknowledged) {
    w.page.drawText('X', { x: M + 2.2, y: boxY - 8.2, size: 8, font: w.bold, color: RED });
  }
  w.page.drawText(
    sanitise(
      input.tollAcknowledged
        ? 'Agreed to pay all tolls, fees and penalties incurred during this rental.'
        : 'NOT AGREED',
    ),
    { x: M + 16, y: boxY - 8, size: 8.5, font: w.bold, color: INK },
  );
  w.y = boxY - 22;

  w.rule(12);
  w.text('CUSTOMER MUST READ AND SIGN HERE', { size: 9, font: w.bold, gap: 5 });
  w.text(READ_AND_SIGN, { size: 8.5, color: MUTED, gap: 14 });

  // signature block
  w.need(90);
  const sigTop = w.y;
  if (input.signatureDataUrl) {
    try {
      const png = await embedSignature(w.doc, input.signatureDataUrl);
      if (png) {
        const dims = png.scaleToFit(190, 46);
        w.page.drawImage(png, { x: M, y: sigTop - dims.height - 4, width: dims.width, height: dims.height });
      }
    } catch {
      /* a broken signature image must not stop the PDF */
    }
  }
  w.page.drawLine({ start: { x: M, y: sigTop - 54 }, end: { x: M + 220, y: sigTop - 54 }, thickness: 0.7, color: RULE });
  w.page.drawText(
    isAdditional ? "Additional Driver's Signature" : 'Client Signature',
    { x: M, y: sigTop - 66, size: 7.5, font: w.regular, color: MUTED },
  );
  w.page.drawText(sanitise(input.signerName), { x: M, y: sigTop - 78, size: 9, font: w.bold, color: INK });

  const rx = A4.w - M - 220;
  w.page.drawText(sanitise(config.company.signerName), { x: rx, y: sigTop - 44, size: 11, font: w.italic, color: INK });
  w.page.drawLine({ start: { x: rx, y: sigTop - 54 }, end: { x: A4.w - M, y: sigTop - 54 }, thickness: 0.7, color: RULE });
  w.page.drawText('Rental Authority Signature', { x: rx, y: sigTop - 66, size: 7.5, font: w.regular, color: MUTED });
  w.page.drawText(formatStamp(input.signedAt), { x: rx, y: sigTop - 78, size: 9, font: w.regular, color: INK });
  w.y = sigTop - 96;

  // ---------------------------------------------------------------- terms
  w.newPage();
  w.text('Rental Agreement', { size: 14, font: w.bold, gap: 8 });
  w.text(RENTAL_INTRO, { size: 8.5, gap: 8 });
  for (const c of RENTAL_CLAUSES) {
    if (c.title) w.text(`${c.n}. ${c.title}`, { size: 9, font: w.bold, gap: 2 });
    for (const b of c.body) w.text(b, { size: 8.5, gap: 3 });
    for (const s of c.sub ?? []) w.text(s, { size: 8.5, indent: 16, gap: 2 });
    w.y -= 3;
  }

  // ---------------------------------------------------------------- waiver
  w.newPage();
  w.text(WAIVER_TITLE, { size: 15, font: w.bold, gap: 10 });
  w.text(
    WAIVER_INTRO.replace('{{date}}', formatLong(input.pickupDate)).replace('{{client_name}}', input.signerName),
    { size: 8.5, gap: 10 },
  );
  for (const c of WAIVER_CLAUSES) {
    if (c.title) w.text(`${c.n}. ${c.title}`, { size: 9, font: w.bold, gap: 2 });
    for (const b of c.body) w.text(b, { size: 8.5, indent: c.title ? 14 : 0, gap: 3 });
    w.y -= 3;
  }
  w.y -= 6;
  w.text(WAIVER_CLOSING, { size: 8.5, gap: 14 });
  w.text(`Client: ${input.signerName}`, { size: 9.5, font: w.bold, gap: 6 });
  w.text(`Date: ${formatLong(input.pickupDate)}`, { size: 9.5, gap: 16 });

  // ---------------------------------------------------------------- audit
  w.rule(10);
  w.text('Electronic signature record', { size: 8.5, font: w.bold, color: MUTED, gap: 4 });
  const audit = [
    `Signed by ${input.signerName} at ${formatStamp(input.signedAt)} (${config.timeZone})`,
    `Booking reference ${input.reference}`,
    `Terms version ${TERMS_VERSION} · SHA-256 ${input.termsHash.slice(0, 32)}...`,
    `IP address ${input.ipAddress ?? 'unknown'}`,
    `Browser ${(input.userAgent ?? 'unknown').slice(0, 110)}`,
  ];
  for (const line of audit) w.text(line, { size: 7.5, color: MUTED, gap: 1 });

  return w.doc.save();
}

async function embedSignature(doc: PDFDocument, dataUrl: string) {
  const match = /^data:image\/(png|jpeg);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const bytes = Buffer.from(match[2], 'base64');
  return match[1] === 'png' ? doc.embedPng(bytes) : doc.embedJpg(bytes);
}
