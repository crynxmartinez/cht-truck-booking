import { prisma } from '@/lib/db';
import { addDays, dateToIso, eachDay, formatMedium, todayInOps, overlaps } from '@/lib/dates';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

/**
 * Six weeks of fleet at a glance — which truck is out, when, and to whom.
 * Answers "can I take Truck A in for service next Tuesday" without opening
 * a single booking.
 */
export default async function CalendarPage() {
  const today = todayInOps();
  const from = today;
  const to = addDays(today, 41);

  const [trucks, bookings, blackouts] = await Promise.all([
    prisma.truck.findMany({ orderBy: { code: 'asc' } }),
    prisma.booking.findMany({
      where: {
        stage: { notIn: ['CANCELLED'] },
        blockStart: { lte: new Date(`${to}T00:00:00Z`) },
        blockEnd: { gte: new Date(`${from}T00:00:00Z`) },
      },
      include: { truck: { select: { code: true } } },
    }),
    prisma.blackoutDate.findMany({
      where: {
        startDate: { lte: new Date(`${to}T00:00:00Z`) },
        endDate: { gte: new Date(`${from}T00:00:00Z`) },
      },
    }),
  ]);

  const days = eachDay(from, to);

  type Cell = { label: string; kind: 'free' | 'booked' | 'blackout'; title: string };

  const grid = trucks.map((t) => {
    const cells: Cell[] = days.map((d) => {
      const bk = bookings.find(
        (b) => b.truckId === t.id && overlaps(d, d, dateToIso(b.blockStart), dateToIso(b.blockEnd)),
      );
      if (bk) {
        return {
          label: `${bk.firstName[0] ?? ''}${bk.lastName[0] ?? ''}`,
          kind: 'booked',
          title: `${bk.firstName} ${bk.lastName} · ${bk.reference} · ${formatMedium(dateToIso(bk.pickupDate))} → ${formatMedium(dateToIso(bk.returnDate))}`,
        };
      }
      const bo = blackouts.find(
        (b) => b.truckId === t.id && overlaps(d, d, dateToIso(b.startDate), dateToIso(b.endDate)),
      );
      if (bo) return { label: '×', kind: 'blackout', title: bo.reason };
      return { label: '', kind: 'free', title: `Truck ${t.code} free on ${formatMedium(d)}` };
    });
    return { truck: t, cells };
  });

  const colour = (k: Cell['kind']) =>
    k === 'booked' ? 'var(--red)' : k === 'blackout' ? '#6b6e73' : 'var(--ok-wash)';

  return (
    <>
      <div className="topbar">
        <h1>Calendar</h1>
        <div className="spacer" />
        <div className="tiny">Next six weeks &middot; {config.timeZone.replace('_', ' ')}</div>
      </div>

      <div className="content">
        <div className="panel">
          <h2>Fleet availability</h2>
          <div className="hint">
            A booking blocks its truck for {config.rentalBlockDays} days from pickup. Hover a cell for who has it.
          </div>

          <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
            <div style={{ minWidth: days.length * 24 + 90 }}>
              <div style={{ display: 'flex', gap: 2, marginLeft: 90, marginBottom: 4 }}>
                {days.map((d) => (
                  <div
                    key={d}
                    style={{
                      width: 22,
                      fontSize: 9,
                      textAlign: 'center',
                      color: d === today ? 'var(--red)' : 'var(--faint)',
                      fontWeight: d === today ? 700 : 400,
                    }}
                  >
                    {d.slice(8)}
                  </div>
                ))}
              </div>

              {grid.map((row) => (
                <div key={row.truck.id} style={{ display: 'flex', gap: 2, alignItems: 'center', marginBottom: 4 }}>
                  <div style={{ width: 86, fontSize: 12.5, fontWeight: 700 }}>
                    Truck {row.truck.code}
                    {!row.truck.active ? <span className="tag" style={{ marginLeft: 4 }}>off</span> : null}
                  </div>
                  {row.cells.map((c, i) => (
                    <div
                      key={i}
                      title={c.title}
                      style={{
                        width: 22,
                        height: 26,
                        borderRadius: 4,
                        background: colour(c.kind),
                        color: c.kind === 'free' ? 'transparent' : '#fff',
                        fontSize: 9,
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: '1px solid ' + (c.kind === 'free' ? '#cfe9dd' : 'transparent'),
                      }}
                    >
                      {c.label}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 16, marginTop: 14, fontSize: 12, color: 'var(--mut)' }}>
            <span>
              <i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: 'var(--ok-wash)', border: '1px solid #cfe9dd', marginRight: 5 }} />
              Free
            </span>
            <span>
              <i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: 'var(--red)', marginRight: 5 }} />
              Booked
            </span>
            <span>
              <i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: '#6b6e73', marginRight: 5 }} />
              Blackout
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
