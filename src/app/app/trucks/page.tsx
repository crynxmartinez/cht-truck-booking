import { prisma } from '@/lib/db';
import { TruckEditor } from './TruckEditor';

export const dynamic = 'force-dynamic';

export default async function TrucksPage() {
  const trucks = await prisma.truck.findMany({ orderBy: { code: 'asc' } });

  return (
    <>
      <div className="topbar">
        <h1>Trucks &amp; lockboxes</h1>
      </div>
      <div className="content">
        {trucks.length === 0 ? (
          <div className="panel">
            <h2>No trucks yet</h2>
            <div className="hint" style={{ marginBottom: 0 }}>
              Run <code>npm run seed</code> to create Truck A and Truck B from your environment variables.
            </div>
          </div>
        ) : (
          trucks.map((t) => <TruckEditor key={t.id} truck={t} />)
        )}

        <div className="panel">
          <h2>A note on lockbox codes</h2>
          <div className="hint" style={{ marginBottom: 0 }}>
            The code seeded from your old checklist form is <code>92584</code>, and every renter who has
            ever used it still knows it. Change it here once the system is live, and again every few
            months. Bookings already confirmed will pick up the new code automatically — the message is
            not composed until 6 AM on the pickup day.
          </div>
        </div>
      </div>
    </>
  );
}
