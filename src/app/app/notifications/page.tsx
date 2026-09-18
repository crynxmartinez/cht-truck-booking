import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { RecipientManager, type RecipientRow } from './RecipientManager';

export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const people = await prisma.notificationRecipient.findMany({
    orderBy: [{ role: 'asc' }, { name: 'asc' }],
  });

  const rows: RecipientRow[] = people.map((p) => ({
    id: p.id,
    name: p.name,
    email: p.email,
    phone: p.phone,
    role: p.role,
    notifyEmail: p.notifyEmail,
    notifySms: p.notifySms,
    active: p.active,
    hasSignature: Boolean(p.signatureData),
    ghlLinked: Boolean(p.ghlContactId),
  }));

  return (
    <>
      <div className="topbar">
        <h1>Notifications</h1>
      </div>
      <div className="content">
        <RecipientManager rows={rows} />

        <div className="panel">
          <h2>What gets sent</h2>
          <div className="hint">
            One alert per stage change, so a clean rental is four messages rather than a running commentary.
          </div>
          <div className="tablewrap">
            <table className="datatable">
              <tbody>
                <tr><td>New booking</td><td className="tiny">Form in, truck assigned, agreement sent</td></tr>
                <tr><td>Second driver named</td><td className="tiny">Renter added one — they get their own agreement</td></tr>
                <tr><td><b>Needs your signature</b></td><td className="tiny">Renter signed. Nothing reaches them until the main admin counter-signs</td></tr>
                <tr><td>Confirmed</td><td className="tiny">Counter-signed — the renter has now been told</td></tr>
                <tr><td>Picked up</td><td className="tiny">Pickup checklist and photos submitted</td></tr>
                <tr><td>Returned</td><td className="tiny">Return checklist in, including any note they left</td></tr>
                <tr><td>Dates moved</td><td className="tiny">A booking was rescheduled — the renter is told too</td></tr>
                <tr><td>Overdue</td><td className="tiny">The day a truck passes its return date. Always texts</td></tr>
                <tr><td>Reschedule asked</td><td className="tiny">Renter replied RESCHEDULE. Always texts</td></tr>
                <tr><td>Cancelled</td><td className="tiny">Booking cancelled or auto-released</td></tr>
              </tbody>
            </table>
          </div>
          <p className="tiny" style={{ marginTop: 12 }}>
            Alerts link to the board at <span className="mono">{config.staff.boardUrl.slice(0, 64)}…</span>
          </p>
        </div>
      </div>
    </>
  );
}
