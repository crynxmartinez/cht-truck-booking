'use client';

import { useState, useTransition } from 'react';
import { BookingModal } from '../BookingModal';
import type { BookingDetail } from '../types';

export type PastRow = {
  id: string;
  reference: string;
  name: string;
  email: string;
  phone: string;
  truck: string | null;
  dates: string;
  stage: string;
  cancelled: boolean;
  closed: string;
};

/** Past rentals, each opening the same booking window as the Board and the Calendar. */
export function PastList({
  rows,
  loadDetail,
}: {
  rows: PastRow[];
  loadDetail: (id: string) => Promise<BookingDetail | null>;
}) {
  const [open, setOpen] = useState<BookingDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [pending, start] = useTransition();

  function show(id: string) {
    setMissing(false);
    start(async () => {
      const detail = await loadDetail(id);
      if (detail) setOpen(detail);
      else setMissing(true);
    });
  }

  return (
    <>
      {missing ? <div className="note alert">That booking could not be opened. It may have been removed.</div> : null}
      <div className="tablewrap">
        <table className="datatable">
          <thead>
            <tr>
              <th>Renter</th>
              <th>Truck</th>
              <th>Dates</th>
              <th>Result</th>
              <th>Closed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                onClick={() => show(r.id)}
                style={{ cursor: pending ? 'progress' : 'pointer' }}
                title="Open this rental"
              >
                <td>
                  <b>{r.name}</b>
                  <br />
                  <span className="tiny">
                    {r.reference} &middot; {r.email} &middot; {r.phone}
                  </span>
                </td>
                <td>{r.truck ?? '—'}</td>
                <td>{r.dates}</td>
                <td>
                  <span className={r.cancelled ? 'tag amber' : 'tag green'}>{r.stage}</span>
                </td>
                <td className="tiny">{r.closed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open ? <BookingModal detail={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
