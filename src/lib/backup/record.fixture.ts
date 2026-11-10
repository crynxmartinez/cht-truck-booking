import type { BookingSource } from './record';

/** A made-up booking for tests. Nothing here is a real person. */
const at = (s: string) => new Date(s);

export const sampleBooking = (): BookingSource => ({
  id: 'b1', reference: 'CHT-SAMPLE', stage: 'COMPLETED',
  pickupDate: at('2026-11-20T00:00:00Z'), returnDate: at('2026-11-22T00:00:00Z'),
  firstName: 'Sample', lastName: 'Renter', email: 'sample@example.com', phone: '+15555550100',
  overdue: false, needsReview: false, reviewNote: null, cancelledAt: null, cancelledReason: null,
  completedAt: at('2026-11-23T10:00:00Z'), createdAt: at('2026-11-01T09:00:00Z'),
  truck: { code: 'A', plate: 'PLATE1', year: 2020 },
  additionalDriver: null,
  contracts: [
    {
      id: 'k1', type: 'RENTAL_AGREEMENT', status: 'SIGNED', payload: { address: '1 Sample St' }, signerName: 'Sample Renter',
      signerEmail: 'sample@example.com', initials: 'SR', tollAcknowledged: true, gasAcknowledged: true, dollyAcknowledged: false,
      termsVersion: 'v2', termsHash: 'abc', ipAddress: '203.0.113.9', userAgent: 'UA', sentAt: at('2026-11-01T09:05:00Z'),
      viewedAt: at('2026-11-01T10:00:00Z'), signedAt: at('2026-11-01T10:05:00Z'), counterSignedAt: at('2026-11-02T08:00:00Z'),
      counterSignerName: 'Main Admin', pdfPathname: 'contracts/k1.pdf',
    },
  ],
  checklists: [
    {
      id: 'c1', phase: 'PICKUP', reportedTime: '9:00 AM', notes: 'Scratch on door', openedAt: null, submittedAt: at('2026-11-20T09:10:00Z'),
      counterSignedAt: null, counterSignerName: null, completionSource: null, completedBy: null, overrideReason: null,
      reportPdfPathname: 'checklists/c1.pdf',
    },
  ],
  documents: [
    { id: 'd1', kind: 'DRIVER_LICENSE', phase: 'BOOKING', source: 'RENTER', contentType: 'image/webp', bytes: 1000, pathname: 'docs/d1.webp', originalFilename: 'IMG_1.jpg', uploadedBy: null, staffNote: null, createdAt: at('2026-11-01T09:01:00Z'), deletedAt: null },
    { id: 'd2', kind: 'CARGO', phase: 'PICKUP', source: 'RENTER', contentType: 'image/webp', bytes: 900, pathname: 'docs/d2.webp', originalFilename: null, uploadedBy: null, staffNote: null, createdAt: at('2026-11-20T09:05:00Z'), deletedAt: at('2026-12-30T00:00:00Z') },
    { id: 'd3', kind: 'SIGNED_CONTRACT', phase: 'CONTRACT', source: 'RENTER', contentType: 'application/pdf', bytes: 5000, pathname: 'contracts/k1.pdf', originalFilename: null, uploadedBy: null, staffNote: null, createdAt: at('2026-11-01T10:06:00Z'), deletedAt: null },
  ],
  messages: [
    { template: 'thank_you', channel: 'EMAIL', status: 'SENT', toAddress: 'sample@example.com', subject: 'Thanks', body: 'Thanks!', error: null, sentAt: at('2026-11-24T10:00:00Z'), createdAt: at('2026-11-24T10:00:00Z') },
    { template: 'contract_to_sign', channel: 'SMS', status: 'SENT', toAddress: '+15555550100', subject: null, body: 'Sign here', error: null, sentAt: at('2026-11-01T09:06:00Z'), createdAt: at('2026-11-01T09:06:00Z') },
  ],
  events: [
    { type: 'stage_change', detail: 'b', actor: 'ops', createdAt: at('2026-11-02T08:00:00Z') },
    { type: 'created', detail: 'a', actor: 'system', createdAt: at('2026-11-01T09:00:00Z') },
  ],
});

