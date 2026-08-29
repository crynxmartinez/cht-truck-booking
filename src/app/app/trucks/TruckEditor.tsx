'use client';

import { useState, useTransition } from 'react';
import { saveTruck, type ActionResult } from '../actions';

export function TruckEditor({
  truck,
}: {
  truck: { id: string; code: string; plate: string; year: number; lockboxCode: string; active: boolean; notes: string | null };
}) {
  const [lockboxCode, setLockbox] = useState(truck.lockboxCode);
  const [active, setActive] = useState(truck.active);
  const [notes, setNotes] = useState(truck.notes ?? '');
  const [flash, setFlash] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  const dirty = lockboxCode !== truck.lockboxCode || active !== truck.active || notes !== (truck.notes ?? '');

  return (
    <div className="panel">
      <h2>
        Truck {truck.code}{' '}
        <span className="tiny" style={{ fontWeight: 400 }}>
          {truck.plate} &middot; {truck.year}
        </span>
      </h2>
      <div className="hint">
        The lockbox code only ever appears in the 6 AM pickup message and on the pickup checklist page.
      </div>

      {flash ? <div className={flash.ok ? 'note ok' : 'note alert'}>{flash.ok ? flash.message : flash.error}</div> : null}

      <div className="row two">
        <div>
          <label htmlFor={`lb-${truck.id}`}>Lockbox code</label>
          <input id={`lb-${truck.id}`} type="text" value={lockboxCode} onChange={(e) => setLockbox(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`ac-${truck.id}`}>Availability</label>
          <select
            id={`ac-${truck.id}`}
            value={active ? 'yes' : 'no'}
            onChange={(e) => setActive(e.target.value === 'yes')}
          >
            <option value="yes">Bookable</option>
            <option value="no">Off the calendar</option>
          </select>
        </div>
      </div>

      <div className="row">
        <label htmlFor={`nt-${truck.id}`}>Notes</label>
        <input
          id={`nt-${truck.id}`}
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything the office should know"
        />
      </div>

      <button
        className="btn primary small"
        disabled={pending || !dirty}
        onClick={() =>
          start(async () => setFlash(await saveTruck(truck.id, { lockboxCode, active, notes })))
        }
      >
        {pending ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  );
}
