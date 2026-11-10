import { createHash } from 'node:crypto';

/**
 * One booking, as a plain record that can be written to JSON and shown in a PDF.
 *
 * Deliberately left out: the secret tokens in the signing and checklist links
 * (anyone holding one can open that page, and the checklist page shows the
 * lockbox code), both as fields and wherever a message's text repeats the link,
 * and the drawn signature images (large, and the signed PDF already carries
 * them). Everything else a person would want after the cloud copy is gone is here.
 */

/** A secret link is a credential, not content: the address stays, the secret part goes. */
export function redactLinks(text: string): string {
  return text.replace(/(\/(?:sign|checklist|api\/files\/contract)\/)[A-Za-z0-9_-]{16,}/g, '$1[link removed]');
}

type D = Date | null;

export type BookingSource = {
  id: string;
  reference: string;
  stage: string;
  pickupDate: Date;
  returnDate: Date;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  overdue: boolean;
  needsReview: boolean;
  reviewNote: string | null;
  cancelledAt: D;
  cancelledReason: string | null;
  completedAt: D;
  createdAt: Date;
  truck: { code: string; plate: string; year: number; lockboxCode?: string | null } | null;
  additionalDriver: {
    name: string; email: string | null; phone: string | null; employer: string | null; employerPhone: string | null;
    street: string | null; city: string | null; state: string | null; zip: string | null; licenseNo: string | null;
    dob: string | null; insuranceCarrier: string | null; insurancePolicyNo: string | null; insurancePhone: string | null;
  } | null;
  contracts: Array<{
    id: string; type: string; status: string; payload: unknown; signerName: string | null; signerEmail: string | null; initials: string | null;
    tollAcknowledged: boolean; gasAcknowledged: boolean; dollyAcknowledged: boolean; termsVersion: string | null; termsHash: string | null;
    ipAddress: string | null; userAgent: string | null; sentAt: Date; viewedAt: D; signedAt: D; counterSignedAt: D; counterSignerName: string | null;
    pdfPathname: string | null;
  }>;
  checklists: Array<{
    id: string; phase: string; reportedTime: string | null; notes: string | null; openedAt: D; submittedAt: D; counterSignedAt: D;
    counterSignerName: string | null; completionSource: string | null; completedBy: string | null; overrideReason: string | null;
    reportPdfPathname: string | null;
  }>;
  documents: Array<{
    id: string; kind: string; phase: string; source: string; contentType: string; bytes: number; pathname: string;
    originalFilename: string | null; uploadedBy: string | null; staffNote: string | null; createdAt: Date; deletedAt: D;
  }>;
  messages: Array<{
    template: string; channel: string; status: string; toAddress: string | null; subject: string | null; body: string | null;
    error: string | null; sentAt: D; createdAt: Date;
  }>;
  events: Array<{ type: string; detail: string | null; actor: string | null; createdAt: Date }>;
};

const iso = (d: D | undefined) => (d ? d.toISOString() : null);
const day = (d: Date) => d.toISOString().slice(0, 10);

/** A file that belongs to the booking and can be fetched from storage. */
export type RecordFile = {
  /** Where it lives in cloud storage. */
  pathname: string;
  /** What it is, in plain words: "Driver license (booking)", "Signed rental agreement". */
  label: string;
  kind: string;
  phase: string;
  contentType: string;
  bytes: number | null;
  /** Already removed from cloud storage. Listed, but there is nothing to download. */
  removed: boolean;
  id: string;
};

export type BackupRecord = {
  reference: string;
  generatedFor: 'backup';
  booking: {
    id: string; stage: string; pickupDate: string; returnDate: string; renter: string; email: string; phone: string;
    truck: string | null; truckPlate: string | null; createdAt: string; completedAt: string | null; cancelledAt: string | null;
    cancelledReason: string | null; overdue: boolean; needsReview: boolean; reviewNote: string | null;
  };
  additionalDriver: BookingSource['additionalDriver'];
  contracts: Array<Record<string, unknown>>;
  checklists: Array<Record<string, unknown>>;
  files: RecordFile[];
  messages: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
};

const DOC_LABEL: Record<string, string> = {
  DRIVER_LICENSE: 'Driver license',
  INSURANCE: 'Proof of insurance',
  CARGO: 'Cargo photo',
  EXTERIOR: 'Exterior photo',
  FUEL_GAUGE: 'Fuel gauge photo',
  OTHER: 'Other photo',
  SIGNED_CONTRACT: 'Signed agreement',
};

export function buildRecord(b: BookingSource): BackupRecord {
  const files: RecordFile[] = b.documents.map((d) => ({
    id: d.id,
    pathname: d.pathname,
    label: `${DOC_LABEL[d.kind] ?? d.kind} (${d.phase.toLowerCase()})`,
    kind: d.kind,
    phase: d.phase,
    contentType: d.contentType,
    bytes: d.bytes,
    removed: d.deletedAt !== null,
  }));

  // The signed agreements and checklist reports are PDFs stored by path on their own rows.
  const known = new Set(files.map((f) => f.pathname));
  for (const c of b.contracts) {
    if (c.pdfPathname && !known.has(c.pdfPathname)) {
      files.push({
        id: `contract-${c.id}`, pathname: c.pdfPathname, kind: 'SIGNED_CONTRACT', phase: 'CONTRACT', contentType: 'application/pdf', bytes: null, removed: false,
        label: c.type === 'RENTAL_AGREEMENT' ? 'Signed rental agreement' : 'Signed additional driver agreement',
      });
      known.add(c.pdfPathname);
    }
  }
  for (const k of b.checklists) {
    if (k.reportPdfPathname && !known.has(k.reportPdfPathname)) {
      files.push({
        id: `checklist-${k.id}`, pathname: k.reportPdfPathname, kind: 'CHECKLIST_REPORT', phase: k.phase, contentType: 'application/pdf', bytes: null, removed: false,
        label: `${k.phase === 'PICKUP' ? 'Pickup' : 'Return'} checklist report`,
      });
      known.add(k.reportPdfPathname);
    }
  }

  const record: BackupRecord = {
    reference: b.reference,
    generatedFor: 'backup',
    booking: {
      id: b.id, stage: b.stage, pickupDate: day(b.pickupDate), returnDate: day(b.returnDate),
      renter: `${b.firstName} ${b.lastName}`.trim(), email: b.email, phone: b.phone,
      truck: b.truck?.code ?? null, truckPlate: b.truck?.plate ?? null,
      createdAt: b.createdAt.toISOString(), completedAt: iso(b.completedAt), cancelledAt: iso(b.cancelledAt),
      cancelledReason: b.cancelledReason, overdue: b.overdue, needsReview: b.needsReview, reviewNote: b.reviewNote,
    },
    additionalDriver: b.additionalDriver,
    contracts: b.contracts.map((c) => ({
      type: c.type, status: c.status, signerName: c.signerName, signerEmail: c.signerEmail, initials: c.initials,
      sentAt: iso(c.sentAt), viewedAt: iso(c.viewedAt), signedAt: iso(c.signedAt),
      approvedAt: iso(c.counterSignedAt), approvedBy: c.counterSignerName,
      tollAcknowledged: c.tollAcknowledged, gasAcknowledged: c.gasAcknowledged, dollyAcknowledged: c.dollyAcknowledged,
      termsVersion: c.termsVersion, termsHash: c.termsHash, ipAddress: c.ipAddress, userAgent: c.userAgent,
      whatTheSignerEntered: c.payload ?? null,
    })),
    checklists: b.checklists.map((k) => ({
      phase: k.phase, reportedTime: k.reportedTime, notes: k.notes, openedAt: iso(k.openedAt), submittedAt: iso(k.submittedAt),
      approvedAt: iso(k.counterSignedAt), approvedBy: k.counterSignerName,
      completionSource: k.completionSource, completedBy: k.completedBy, overrideReason: k.overrideReason,
    })),
    files,
    messages: [...b.messages]
      .sort((x, y) => (x.sentAt ?? x.createdAt).getTime() - (y.sentAt ?? y.createdAt).getTime())
      .map((m) => ({
        at: iso(m.sentAt ?? m.createdAt), template: m.template, channel: m.channel, status: m.status,
        to: m.toAddress, subject: m.subject, body: m.body, error: m.error,
      })),
    events: [...b.events]
      .sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())
      .map((e) => ({ at: e.createdAt.toISOString(), type: e.type, detail: e.detail, actor: e.actor })),
  };

  // Every piece of free text (message bodies, notes, event details, what the signer typed) is
  // scrubbed in one pass, so a link cannot slip through by turning up somewhere unexpected.
  return JSON.parse(redactLinks(JSON.stringify(record))) as BackupRecord;
}

/** Stable fingerprint of what the record says, so a later run can tell whether anything changed. */
export function recordFingerprint(r: BackupRecord): string {
  return createHash('sha256').update(JSON.stringify(r)).digest('hex');
}

/** The booking list for the spreadsheet: one row per booking. */
export const CSV_HEADERS = [
  'Reference', 'Renter', 'Email', 'Phone', 'Stage', 'Truck', 'Pickup', 'Return',
  'Created', 'Completed', 'Cancelled', 'Signed by renter', 'Approved', 'Files', 'Folder',
] as const;

export function csvRow(r: BackupRecord, folder: string): unknown[] {
  const rental = r.contracts.find((c) => c.type === 'RENTAL_AGREEMENT');
  return [
    r.reference, r.booking.renter, r.booking.email, r.booking.phone, r.booking.stage, r.booking.truck ?? '',
    r.booking.pickupDate, r.booking.returnDate, r.booking.createdAt.slice(0, 10), r.booking.completedAt?.slice(0, 10) ?? '',
    r.booking.cancelledAt?.slice(0, 10) ?? '', (rental?.signedAt as string | null)?.slice(0, 10) ?? '',
    (rental?.approvedAt as string | null)?.slice(0, 10) ?? '', r.files.length, folder,
  ];
}
