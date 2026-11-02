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
          <h2>What happens when you change a lockbox code</h2>
          <div className="hint" style={{ marginBottom: 0 }}>
            The code is looked up at the moment a message is sent, not when the booking was made.
            <ul style={{ margin: '8px 0 8px 18px', padding: 0 }}>
              <li>
                <b>Messages not sent yet</b> use the new code. That covers everyone booked for a future
                day, whether or not they are already confirmed.
              </li>
              <li>
                <b>Messages already sent</b> keep the old code. They cannot be changed once they are out.
              </li>
              <li>
                <b>The checklist link</b> in a message shows the new code as soon as you save, even if the
                text they received says the old one.
              </li>
              <li>
                Three messages carry the code: the pickup-day text, the reminder, and the final text. Each
                is looked up when it is sent, so if you change the code partway through a day, a renter
                can be sent two different codes.
              </li>
            </ul>
            So the safest time to change a code is when nobody is collecting that day. If a renter already
            has the old one, tell them yourself. Every message is shown on the Messages page and on each
            booking.
          </div>
        </div>
      </div>
    </>
  );
}
