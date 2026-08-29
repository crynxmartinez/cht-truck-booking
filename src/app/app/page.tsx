import { prisma } from '@/lib/db';
import { BOARD_STAGES } from '@/lib/stages';
import { dateToIso, formatMedium, formatStamp } from '@/lib/dates';
import { checklistUrl, signUrl } from '@/lib/tokens';
import { requireSession } from '@/lib/auth';
import { Board } from './Board';
import type { BookingDetail, CardData } from './types';

export const dynamic = 'force-dynamic';

/** Loads the full file for one booking. Called from the board when a card opens. */
async function loadDetail(id: string): Promise<BookingDetail | null> {
  'use server';
  await requireSession();

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

  return {
    card: toCard(b),
    reviewNote: b.reviewNote,
    additionalDriverName: b.additionalDriver?.name ?? null,
    additionalDriverContact:
      [b.additionalDriver?.email, b.additionalDriver?.phone].filter(Boolean).join(' · ') || null,
    documents: b.documents.map((d) => ({
      id: d.id,
      kind: d.kind,
      phase: d.phase,
      url: d.url,
      isImage: d.contentType.startsWith('image/'),
    })),
    contracts: b.contracts.map((k) => ({
      id: k.id,
      type: k.type,
      status: k.status,
      signerName: k.signerName,
      signedLabel: k.signedAt ? formatStamp(k.signedAt) : k.viewedAt ? `viewed ${formatStamp(k.viewedAt)}` : '—',
      pdfUrl: k.pdfUrl,
      link: signUrl(k.token),
    })),
    checklists: b.checklists.map((k) => ({
      phase: k.phase,
      submittedLabel: k.submittedAt ? formatStamp(k.submittedAt) : k.openedAt ? `opened ${formatStamp(k.openedAt)}` : '—',
      reportedTime: k.reportedTime,
      notes: k.notes,
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

function toCard(b: BookingRow): CardData {
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

export default async function BoardPage() {
  const [bookings, trucks] = await Promise.all([
    prisma.booking.findMany({
      where: { stage: { in: BOARD_STAGES } },
      include: { truck: { select: { code: true } } },
      orderBy: [{ pickupDate: 'asc' }, { createdAt: 'asc' }],
      take: 500,
    }),
    prisma.truck.findMany({ where: { active: true }, select: { id: true, code: true }, orderBy: { code: 'asc' } }),
  ]);

  return <Board cards={bookings.map(toCard)} trucks={trucks} loadDetail={loadDetail} />;
}
