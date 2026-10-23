import { prisma } from '@/lib/db';
import { dateToIso, formatMedium, formatStamp, todayInOps } from '@/lib/dates';
import { freeTrucksFor } from '@/lib/availability';
import { swapWindowOpen } from '@/lib/truck-swap';
import { checklistUrl, signUrl } from '@/lib/tokens';
import { signedFilePath } from '@/lib/file-urls';
import type { BookingDetail, CardData, SwapOption } from './types';

/**
 * Shared booking loader. The board and the calendar open the same modal, so
 * they must build the same payload — two copies would drift the moment one
 * gained a field.
 */

type BookingRow = {
  id: string;
  reference: string;
  stage: CardData['stage'];
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  pickupDate: Date;
  returnDate: Date;
  overdue: boolean;
  needsReview: boolean;
  rescheduleAsked: boolean;
  additionalDriverRequested: boolean;
  createdAt: Date;
  truckId: string | null;
  truck: { code: string } | null;
};

export function toCard(b: BookingRow): CardData {
  return {
    id: b.id,
    reference: b.reference,
    stage: b.stage,
    name: `${b.firstName} ${b.lastName}`.trim(),
    email: b.email,
    phone: b.phone,
    truckCode: b.truck?.code ?? null,
    truckId: b.truckId,
    pickupLabel: formatMedium(dateToIso(b.pickupDate)),
    returnLabel: formatMedium(dateToIso(b.returnDate)),
    pickupIso: dateToIso(b.pickupDate),
    returnIso: dateToIso(b.returnDate),
    overdue: b.overdue,
    needsReview: b.needsReview,
    rescheduleAsked: b.rescheduleAsked,
    additionalDriver: b.additionalDriverRequested,
    createdLabel: formatStamp(b.createdAt),
  };
}


/**
 * The trucks this booking could move to, if it can move at all.
 *
 * Only switched-on trucks are offered. Availability is read for the booking's
 * own dates; the booking itself sits on its current truck, so it can never
 * make another truck look busy.
 */
async function swapOptionsFor(args: {
  bookingId: string;
  stage: string;
  pickupIso: string;
  rentalDays: number;
  currentTruckId: string | null;
}): Promise<SwapOption[]> {
  const today = todayInOps();
  // Only the day itself cares whether the code is out; skip the query otherwise.
  const codeSent =
    args.pickupIso === today &&
    (await prisma.messageLog.count({
      where: {
        bookingId: args.bookingId,
        template: 'pickup_morning',
        recipientKey: 'renter',
        status: { in: ['QUEUED', 'SENT'] },
      },
    })) > 0;

  const window = swapWindowOpen({ stage: args.stage, pickupDate: args.pickupIso, today, codeSent });
  if (!window.ok) return [];

  const [others, availability] = await Promise.all([
    prisma.truck.findMany({
      where: { active: true, ...(args.currentTruckId ? { id: { not: args.currentTruckId } } : {}) },
      select: { id: true, code: true },
      orderBy: { code: 'asc' },
    }),
    freeTrucksFor(args.pickupIso, args.rentalDays),
  ]);

  return others.map((t) => {
    const busy = availability.taken.find((x) => x.code === t.code);
    return { id: t.id, code: t.code, free: !busy, note: busy ? busy.reason : null };
  });
}

/** Loads the full file for one booking. Called from the board when a card opens. */
export async function loadBookingDetail(id: string): Promise<BookingDetail | null> {
  const b = await prisma.booking.findUnique({
    where: { id },
    include: {
      truck: true,
      additionalDriver: true,
      documents: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
      contracts: { orderBy: { createdAt: 'asc' } },
      checklists: { orderBy: { phase: 'asc' } },
      messages: { orderBy: { createdAt: 'desc' }, take: 40 },
      events: { orderBy: { createdAt: 'desc' }, take: 60 },
    },
  });
  if (!b) return null;

  const pickupIso = dateToIso(b.pickupDate);
  const rentalDays =
    Math.round((b.blockEnd.getTime() - b.blockStart.getTime()) / 86_400_000) + 1;

  const swap = await swapOptionsFor({
    bookingId: b.id,
    stage: b.stage,
    pickupIso,
    rentalDays,
    currentTruckId: b.truckId,
  });

  return {
    card: toCard(b),
    swap,
    rentalDays,
    pickupIso,
    reviewNote: b.reviewNote,
    additionalDriverName: b.additionalDriver?.name ?? null,
    additionalDriverContact:
      [b.additionalDriver?.email, b.additionalDriver?.phone].filter(Boolean).join(' · ') || null,
    // Blobs are private. Mint a short-lived signed link per file so the board
    // can render thumbnails without the underlying object ever being public.
    documents: b.documents.map((d) => ({
      id: d.id,
      kind: d.kind,
      phase: d.phase,
      source: d.source,
      uploadedBy: d.uploadedBy,
      receivedLabel: d.receivedAt ? formatStamp(d.receivedAt) : null,
      originalFilename: d.originalFilename,
      url: signedFilePath(d.id),
      isImage: d.contentType.startsWith('image/'),
    })),
    contracts: b.contracts.map((k) => ({
      id: k.id,
      type: k.type,
      status: k.status,
      signerName: k.signerName,
      counterSignedLabel: k.counterSignedAt ? `${k.counterSignerName ?? 'Admin'} · ${formatStamp(k.counterSignedAt)}` : null,
      signedLabel: k.signedAt ? formatStamp(k.signedAt) : k.viewedAt ? `viewed ${formatStamp(k.viewedAt)}` : '—',
      pdfUrl: k.pdfPathname ? `/api/files/contract/${k.token}` : null,
      link: signUrl(k.token),
    })),
    checklists: b.checklists.map((k) => ({
      id: k.id,
      phase: k.phase,
      counterSignedLabel: k.counterSignedAt ? `${k.counterSignerName ?? 'Admin'} · ${formatStamp(k.counterSignedAt)}` : null,
      submitted: Boolean(k.submittedAt),
      submittedLabel: k.submittedAt ? formatStamp(k.submittedAt) : k.openedAt ? `opened ${formatStamp(k.openedAt)}` : '—',
      reportedTime: k.reportedTime,
      notes: k.notes,
      completionSource: k.completionSource,
      completedBy: k.completedBy,
      overrideReason: k.overrideReason,
      link: checklistUrl(k.token),
    })),
    messages: b.messages.map((m) => ({
      template: m.template,
      channel: m.channel,
      status: m.status,
      sentLabel: formatStamp(m.sentAt ?? m.createdAt),
      error: m.error,
    })),
    events: b.events.map((e) => ({
      type: e.type,
      detail: e.detail,
      actor: e.actor,
      atLabel: formatStamp(e.createdAt),
    })),
  };
}
