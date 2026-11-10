'use client';

import { useState } from 'react';
import { addNote, resend } from '../actions';
import type { PanelProps } from './panel';

const RESENDABLE: Array<{ key: string; label: string }> = [
  { key: 'contract_to_sign', label: 'Contract link' },
  { key: 'rental_confirmed', label: 'Confirmation' },
  { key: 'pickup_morning', label: 'Pickup + lockbox code' },
  { key: 'return_day', label: 'Return reminder' },
  { key: 'thank_you', label: 'Thank you' },
];

/** What has happened on this booking, a place for notes, and sending an automatic message again. */
export function ActivityPanel({ detail, pending, run }: PanelProps) {
  const c = detail.card;
  const [note, setNote] = useState('');

  return (
    <>
      <div className="sect" style={{ marginTop: 0 }}>Add a note</div>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything worth recording…" aria-label="Note" />
      <button
        className="btn ghost small"
        style={{ marginTop: 8 }}
        disabled={pending || !note.trim()}
        onClick={() =>
          run(async () => {
            const r = await addNote(c.id, note);
            if (r.ok) setNote('');
            return r;
          })
        }
      >
        Save note
      </button>

      <div className="sect">Send an automatic message again</div>
      <p className="tiny" style={{ marginTop: 0 }}>
        These go out exactly as they did the first time, by text and email.
      </p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {RESENDABLE.map((r) => (
          <button key={r.key} className="btn ghost small" disabled={pending} onClick={() => run(() => resend(c.id, r.key))}>
            {r.label}
          </button>
        ))}
      </div>

      <div className="sect">Activity</div>
      <div className="timeline">
        {detail.events.map((e, i) => (
          <div key={i}>
            <b>{e.detail || e.type.replace(/_/g, ' ')}</b>
            <small>
              {e.atLabel} &middot; {e.actor}
            </small>
          </div>
        ))}
      </div>
    </>
  );
}
