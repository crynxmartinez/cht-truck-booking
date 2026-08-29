'use client';

import { useState, useTransition } from 'react';
import { addBlackout, removeBlackout, type ActionResult } from '../actions';

type Row = { id: string; truckCode: string; startLabel: string; endLabel: string; reason: string };

export function BlackoutManager({
  trucks,
  rows,
}: {
  trucks: Array<{ id: string; code: string }>;
  rows: Row[];
}) {
  const [truckId, setTruckId] = useState(trucks[0]?.id ?? '');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [reason, setReason] = useState('');
  const [flash, setFlash] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <div className="panel">
        <h2>Take a truck off the calendar</h2>
        <div className="hint">
          Service, repairs, or a week you need it yourself. Blacked-out dates stop being offered on the
          booking widget immediately.
        </div>

        {flash ? <div className={flash.ok ? 'note ok' : 'note alert'}>{flash.ok ? flash.message : flash.error}</div> : null}

        <div className="row three">
          <div>
            <label htmlFor="bt">Truck</label>
            <select id="bt" value={truckId} onChange={(e) => setTruckId(e.target.value)}>
              {trucks.map((t) => (
                <option key={t.id} value={t.id}>
                  Truck {t.code}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="bs">From</label>
            <input id="bs" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <label htmlFor="be">To (inclusive)</label>
            <input id="be" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <div className="row">
          <label htmlFor="br">Reason</label>
          <input
            id="br"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Oil change, brake job, family move…"
          />
        </div>

        <button
          className="btn primary small"
          disabled={pending || !truckId || !start || !end}
          onClick={() =>
            startTransition(async () => {
              const res = await addBlackout(truckId, start, end, reason);
              setFlash(res);
              if (res.ok) {
                setStart('');
                setEnd('');
                setReason('');
              }
            })
          }
        >
          {pending ? 'Saving…' : 'Block these dates'}
        </button>
      </div>

      <div className="panel">
        <h2>Current blackouts</h2>
        {rows.length === 0 ? (
          <div className="hint" style={{ marginBottom: 0 }}>
            Nothing blocked. Both trucks are on the calendar.
          </div>
        ) : (
          <div className="tablewrap">
            <table className="datatable">
              <thead>
                <tr>
                  <th>Truck</th>
                  <th>Dates</th>
                  <th>Reason</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>Truck {r.truckCode}</td>
                    <td>
                      {r.startLabel} &rarr; {r.endLabel}
                    </td>
                    <td>{r.reason}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="btn ghost small"
                        disabled={pending}
                        onClick={() => startTransition(async () => setFlash(await removeBlackout(r.id)))}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
