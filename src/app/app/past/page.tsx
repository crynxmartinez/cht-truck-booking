import Link from 'next/link';
import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { dateToIso, formatMedium, formatStamp } from '@/lib/dates';
import { PAST_PAGE_SIZE, parsePastParams, pastOrder, pastWhere, type PastParams } from '@/lib/board-window';
import { STAGE_LABEL } from '@/lib/stages';
import { loadSettings } from '@/lib/settings';
import { loadBookingDetail } from '../detail';
import type { BookingDetail } from '../types';
import { PastList, type PastRow } from './PastList';

export const dynamic = 'force-dynamic';

async function loadDetail(id: string): Promise<BookingDetail | null> {
  'use server';
  return loadBookingDetail(id);
}

function href(p: PastParams, over: Partial<PastParams>): string {
  const next = { ...p, ...over };
  const qs = new URLSearchParams();
  if (next.q) qs.set('q', next.q);
  if (next.show !== 'all') qs.set('show', next.show);
  if (next.page > 1) qs.set('page', String(next.page));
  const s = qs.toString();
  return `/app/past${s ? `?${s}` : ''}`;
}

/**
 * Every rental that is over, kept for good: Completed ones leave the Board
 * after a while but are never deleted, and Cancelled ones are kept here too.
 */
export default async function PastRentalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await loadSettings();
  const params = parsePastParams(await searchParams);
  const where = pastWhere(params);

  const [total, bookings] = await Promise.all([
    prisma.booking.count({ where }),
    prisma.booking.findMany({
      where,
      include: { truck: { select: { code: true } } },
      orderBy: pastOrder(),
      skip: (params.page - 1) * PAST_PAGE_SIZE,
      take: PAST_PAGE_SIZE,
    }),
  ]);

  const rows: PastRow[] = bookings.map((b) => ({
    id: b.id,
    reference: b.reference,
    name: `${b.firstName} ${b.lastName}`.trim(),
    email: b.email,
    phone: b.phone,
    truck: b.truck?.code ? `Truck ${b.truck.code}` : null,
    dates: `${formatMedium(dateToIso(b.pickupDate))} → ${formatMedium(dateToIso(b.returnDate))}`,
    stage: STAGE_LABEL[b.stage],
    cancelled: b.stage === 'CANCELLED',
    closed: formatStamp(b.completedAt ?? b.cancelledAt ?? b.updatedAt),
  }));

  const pages = Math.max(1, Math.ceil(total / PAST_PAGE_SIZE));
  const tab = (show: PastParams['show'], label: string) => (
    <Link
      href={href(params, { show, page: 1 })}
      className={`btn small ${params.show === show ? 'primary' : 'ghost'}`}
    >
      {label}
    </Link>
  );

  return (
    <>
      <div className="topbar">
        <h1>Past rentals</h1>
      </div>
      <div className="content">
        <div className="panel">
          <div className="hint">
            Every finished or cancelled rental, kept for good. Completed rentals stay on the Board for{' '}
            {config.completedHideDays} day{config.completedHideDays === 1 ? '' : 's'} and then move here; you can change
            that under <Link href="/app/settings">Settings</Link>. Click a rental to open it.
          </div>

          <form method="get" action="/app/past" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0 12px' }}>
            <input
              type="search"
              name="q"
              defaultValue={params.q}
              placeholder="Search name, email, phone or reference"
              aria-label="Search past rentals"
              style={{ flex: '1 1 260px' }}
            />
            {params.show !== 'all' ? <input type="hidden" name="show" value={params.show} /> : null}
            <button className="btn small" type="submit">
              Search
            </button>
            {params.q ? (
              <Link className="btn ghost small" href={href(params, { q: '', page: 1 })}>
                Clear
              </Link>
            ) : null}
          </form>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {tab('all', 'All')}
            {tab('completed', 'Completed')}
            {tab('cancelled', 'Cancelled')}
          </div>

          {rows.length === 0 ? (
            <p className="tiny">{params.q ? `Nothing matches “${params.q}”.` : 'No past rentals yet.'}</p>
          ) : (
            <PastList rows={rows} loadDetail={loadDetail} />
          )}

          <p className="tiny" style={{ marginTop: 12 }}>
            {total} rental{total === 1 ? '' : 's'}
            {pages > 1 ? ` · page ${params.page} of ${pages}` : ''}
          </p>
          {pages > 1 ? (
            <div style={{ display: 'flex', gap: 8 }}>
              {params.page > 1 ? (
                <Link className="btn ghost small" href={href(params, { page: params.page - 1 })}>
                  &larr; Newer
                </Link>
              ) : null}
              {params.page < pages ? (
                <Link className="btn ghost small" href={href(params, { page: params.page + 1 })}>
                  Older &rarr;
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
