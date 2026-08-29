import { prisma } from '@/lib/db';
import { dateToIso, formatMedium } from '@/lib/dates';
import { BlackoutManager } from './BlackoutManager';

export const dynamic = 'force-dynamic';

export default async function BlackoutsPage() {
  const [trucks, blackouts] = await Promise.all([
    prisma.truck.findMany({ orderBy: { code: 'asc' }, select: { id: true, code: true } }),
    prisma.blackoutDate.findMany({
      include: { truck: { select: { code: true } } },
      orderBy: { startDate: 'asc' },
    }),
  ]);

  return (
    <>
      <div className="topbar">
        <h1>Blackout dates</h1>
      </div>
      <div className="content">
        <BlackoutManager
          trucks={trucks}
          rows={blackouts.map((b) => ({
            id: b.id,
            truckCode: b.truck.code,
            startLabel: formatMedium(dateToIso(b.startDate)),
            endLabel: formatMedium(dateToIso(b.endDate)),
            reason: b.reason,
          }))}
        />
      </div>
    </>
  );
}
