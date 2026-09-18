import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { dateToIso, todayInOps } from '@/lib/dates';
import { layout, monthWeeks, type CalItem } from '@/lib/calendar-layout';
import { MonthCalendar } from './MonthCalendar';
import type { BookingDetail, TruckOption } from '../types';
import { loadBookingDetail } from '../detail';

export const dynamic = 'force-dynamic';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

async function loadDetail(id: string): Promise<BookingDetail | null> {
  'use server';
  return loadBookingDetail(id);
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; truck?: string }>;
}) {
  const sp = await searchParams;
  const today = todayInOps();

  // ?m=YYYY-MM keeps navigation a plain link — no client state to desync.
  const m = /^\d{4}-\d{2}$/.test(sp.m ?? '') ? sp.m! : today.slice(0, 7);
  const [year, month1] = m.split('-').map(Number);
  const monthIndex = Math.min(11, Math.max(0, month1 - 1));
  const filter = sp.truck === 'A' || sp.truck === 'B' ? sp.truck : null;

  const weeks = monthWeeks(year, monthIndex);
  const from = weeks[0].days[0];
  const to = weeks[weeks.length - 1].days[6];

  const [bookings, blackouts, trucks] = await Promise.all([
    prisma.booking.findMany({
      where: {
        stage: { notIn: ['CANCELLED'] },
        blockStart: { lte: new Date(`${to}T00:00:00Z`) },
        blockEnd: { gte: new Date(`${from}T00:00:00Z`) },
      },
      include: { truck: { select: { code: true } }, contracts: { select: { status: true, counterSignedAt: true } } },
    }),
    prisma.blackoutDate.findMany({
      where: {
        startDate: { lte: new Date(`${to}T00:00:00Z`) },
        endDate: { gte: new Date(`${from}T00:00:00Z`) },
      },
      include: { truck: { select: { code: true } } },
    }),
    prisma.truck.findMany({ where: { active: true }, select: { id: true, code: true }, orderBy: { code: 'asc' } }),
  ]);

  const items: CalItem[] = [
    ...bookings
      .filter((b) => !filter || b.truck?.code === filter)
      .map<CalItem>((b) => ({
        id: b.id,
        kind: 'booking',
        truck: (b.truck?.code as 'A' | 'B') ?? null,
        label: `${b.firstName} ${b.lastName}`.trim(),
        sublabel: b.reference,
        start: dateToIso(b.blockStart),
        end: dateToIso(b.blockEnd),
        unsigned: b.contracts.some((c) => c.status === 'SIGNED' && !c.counterSignedAt),
      })),
    ...blackouts
      .filter((x) => !filter || x.truck.code === filter)
      .map<CalItem>((x) => ({
        id: x.id,
        kind: 'blackout',
        truck: x.truck.code as 'A' | 'B',
        label: `Truck ${x.truck.code} blocked`,
        sublabel: x.reason,
        start: dateToIso(x.startDate),
        end: dateToIso(x.endDate),
      })),
  ];

  layout(weeks, items);

  const prev = new Date(Date.UTC(year, monthIndex - 1, 1));
  const next = new Date(Date.UTC(year, monthIndex + 1, 1));
  const href = (d: Date) =>
    `/app/calendar?m=${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` +
    (filter ? `&truck=${filter}` : '');

  return (
    <>
      <div className="topbar">
        <h1>Calendar</h1>
        <div className="spacer" />
        <div className="tiny">{config.timeZone.replace('_', ' ')}</div>
      </div>

      <div className="content">
        <MonthCalendar
          title={`${MONTHS[monthIndex]} ${year}`}
          prevHref={href(prev)}
          nextHref={href(next)}
          todayHref={`/app/calendar${filter ? `?truck=${filter}` : ''}`}
          filter={filter}
          filterHrefs={{
            all: `/app/calendar?m=${m}`,
            a: `/app/calendar?m=${m}&truck=A`,
            b: `/app/calendar?m=${m}&truck=B`,
          }}
          monthIndex={monthIndex}
          today={today}
          weeks={weeks.map((w) => ({
            days: w.days,
            lanes: w.lanes,
            segments: w.segments.map((s) => ({
              id: s.item.id,
              kind: s.item.kind,
              truck: s.item.truck,
              label: s.item.label,
              sublabel: s.item.sublabel ?? null,
              start: s.item.start,
              end: s.item.end,
              unsigned: Boolean(s.item.unsigned),
              col: s.col,
              span: s.span,
              lane: s.lane,
              isStart: s.isStart,
              isEnd: s.isEnd,
            })),
          }))}
          trucks={trucks as TruckOption[]}
          loadDetail={loadDetail}
        />
      </div>
    </>
  );
}
