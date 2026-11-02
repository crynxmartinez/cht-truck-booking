import Link from 'next/link';
import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { loadSettings } from '@/lib/settings';
import { dateToIso, formatMedium, formatStamp, todayInOps } from '@/lib/dates';
import { explainFailure, isUrgentFailure } from '@/lib/failures';
import { STAGE_LABEL } from '@/lib/stages';

export const dynamic = 'force-dynamic';

/**
 * Everything the office actually has to do something about, in one list.
 * Overdue trucks, reschedule replies, renter notes, and contracts nobody has
 * signed — deliberately not a board column, because a stuck booking should
 * stay visible in the stage it is stuck in.
 */
export default async function AttentionPage() {
  await loadSettings();
  const cutoff24 = new Date(Date.now() - 24 * 3600_000);
  const today = todayInOps();

  const [flagged, unsigned, failed] = await Promise.all([
    prisma.booking.findMany({
      where: {
        stage: { notIn: ['COMPLETED', 'CANCELLED'] },
        OR: [{ overdue: true }, { needsReview: true }, { rescheduleAsked: true }],
      },
      include: { truck: { select: { code: true } } },
      orderBy: { pickupDate: 'asc' },
    }),
    prisma.booking.findMany({
      where: {
        stage: { in: ['CONTRACT_SENT', 'ADDITIONAL_DRIVER'] },
        createdAt: { lte: cutoff24 },
      },
      include: { truck: { select: { code: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.messageLog.findMany({
      where: { status: 'FAILED' },
      include: {
        booking: { select: { reference: true, firstName: true, lastName: true, stage: true, pickupDate: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
  ]);

  const nothing = !flagged.length && !unsigned.length && !failed.length;

  return (
    <>
      <div className="topbar">
        <h1>Needs attention</h1>
      </div>
      <div className="content">
        {nothing ? (
          <div className="panel">
            <h2>All clear</h2>
            <div className="hint" style={{ marginBottom: 0 }}>
              No overdue trucks, no unsigned contracts older than a day, and every message went out.
            </div>
          </div>
        ) : null}

        {flagged.length ? (
          <div className="panel">
            <h2>Flagged bookings</h2>
            <div className="hint">Overdue, reschedule requests, and returns with a renter note.</div>
            <div className="tablewrap">
              <table className="datatable">
                <thead>
                  <tr>
                    <th>Renter</th>
                    <th>Truck</th>
                    <th>Dates</th>
                    <th>Stage</th>
                    <th>Why</th>
                  </tr>
                </thead>
                <tbody>
                  {flagged.map((b) => (
                    <tr key={b.id}>
                      <td>
                        <b>
                          {b.firstName} {b.lastName}
                        </b>
                        <br />
                        <span className="tiny">{b.reference}</span>
                      </td>
                      <td>{b.truck?.code ?? '—'}</td>
                      <td>
                        {formatMedium(dateToIso(b.pickupDate))} &rarr; {formatMedium(dateToIso(b.returnDate))}
                      </td>
                      <td>{STAGE_LABEL[b.stage]}</td>
                      <td>
                        {b.overdue ? <span className="tag red">Overdue</span> : null}{' '}
                        {b.rescheduleAsked ? <span className="tag amber">Reschedule</span> : null}{' '}
                        {b.needsReview ? <span className="tag blue">Review</span> : null}
                        {b.reviewNote ? <div className="tiny">&ldquo;{b.reviewNote}&rdquo;</div> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {unsigned.length ? (
          <div className="panel">
            <h2>Unsigned over 24 hours</h2>
            <div className="hint">
              Each gets one automatic reminder, and the truck is released if it is still unsigned after{' '}
              {config.unsignedReleaseHours} hours. The renter is not told when that happens.
            </div>
            <div className="tablewrap">
              <table className="datatable">
                <thead>
                  <tr>
                    <th>Renter</th>
                    <th>Truck</th>
                    <th>Pickup</th>
                    <th>Booked</th>
                  </tr>
                </thead>
                <tbody>
                  {unsigned.map((b) => (
                    <tr key={b.id}>
                      <td>
                        <b>
                          {b.firstName} {b.lastName}
                        </b>
                        <br />
                        <span className="tiny">{b.reference}</span>
                      </td>
                      <td>{b.truck?.code ?? '—'}</td>
                      <td>{formatMedium(dateToIso(b.pickupDate))}</td>
                      <td>{formatStamp(b.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {failed.length ? (
          <div className="panel">
            <h2>Messages that failed</h2>
            <div className="hint">
              Each row says why it failed and what to do. To read exactly what was meant to be sent, open the
              booking on the <Link href="/app">board</Link> and click the message. A text that is blocked
              because the person opted out, or has Do Not Disturb on, can never be sent from here: call them.
            </div>
            <div className="tablewrap">
              <table className="datatable">
                <thead>
                  <tr>
                    <th>Renter</th>
                    <th>Message</th>
                    <th>What happened, and what to do</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {failed.map((m) => {
                    const why = explainFailure(m.error, m.channel);
                    const urgent = isUrgentFailure({
                      channel: m.channel,
                      template: m.template,
                      stage: m.booking.stage,
                      pickupIso: dateToIso(m.booking.pickupDate),
                      todayIso: today,
                    });
                    return (
                      <tr key={m.id}>
                        <td>
                          {m.booking.firstName} {m.booking.lastName}
                          <br />
                          <span className="tiny">{m.booking.reference}</span>
                        </td>
                        <td>
                          {m.template.replace(/_/g, ' ')}
                          <br />
                          <span className="tiny">{m.channel.toLowerCase()}</span>
                        </td>
                        <td>
                          {urgent ? (
                            <span className="tag red">Call them now: they have not got their lockbox code</span>
                          ) : null}
                          <div className="tiny" style={{ marginTop: urgent ? 6 : 0 }}>
                            {why.reason}
                          </div>
                          <div className="tiny">
                            <b>{why.action}</b>
                          </div>
                        </td>
                        <td>{formatStamp(m.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
