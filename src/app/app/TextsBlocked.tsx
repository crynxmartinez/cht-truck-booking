'use client';

import { useState, useTransition } from 'react';
import { turnTextsBackOn, type ActionResult } from './actions';
import { CONSENT_WAYS, MAX_NOTE, MIN_NOTE } from '@/lib/sms-consent';

/**
 * Shown only when texts to this renter are blocked. We never switch the block
 * off on our own: the office does it here, and only because the renter asked,
 * with how and when written down. A second click confirms, so it is never one tap.
 */
export function TextsBlocked({
  bookingId,
  name,
  kind,
  onResult,
}: {
  bookingId: string;
  name: string;
  kind: 'dnd' | 'unsubscribed';
  onResult: (r: ActionResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const [way, setWay] = useState('');
  const [note, setNote] = useState('');
  const [sure, setSure] = useState(false);
  const [restored, setRestored] = useState(false);
  const [pending, start] = useTransition();

  function submit() {
    start(async () => {
      try {
        const result = await turnTextsBackOn(bookingId, way, note);
        onResult(result);
        if (result.ok) {
          setRestored(true);
          setOpen(false);
          setWay('');
          setNote('');
          setSure(false);
        } else {
          setSure(false);
        }
      } catch {
        onResult({ ok: false, error: 'That did not work. Try again.' });
        setSure(false);
      }
    });
  }

  if (restored) {
    return (
      <div className="note info" role="status" style={{ marginTop: 12 }}>
        Texts are back on for {name}. Press Resend for anything they missed, or write them a message below.
      </div>
    );
  }

  return (
    <div className="note warn" role="status" style={{ marginTop: 12 }}>
      <div className="blocked-row">
        <span>
          <span style={{ fontWeight: 700 }}>Texts to {name} are blocked.</span>{' '}
          {kind === 'unsubscribed'
            ? 'They replied STOP, so they have opted out of our texts.'
            : 'They have Do Not Disturb switched on in GoHighLevel.'}{' '}
          Email still goes, and you can call them. We do not text past this.
        </span>
        {!open ? (
          <button type="button" className="btn ghost small" onClick={() => setOpen(true)}>
            They asked for texts again
          </button>
        ) : null}
      </div>
      {open ? (
        <div style={{ marginTop: 8 }}>
          <label htmlFor="tb-way">How did {name} ask?</label>
          <select
            id="tb-way"
            value={way}
            onChange={(e) => {
              setWay(e.target.value);
              setSure(false);
            }}
          >
            <option value="">Choose…</option>
            {CONSENT_WAYS.map((w) => (
              <option key={w.key} value={w.key}>
                {w.label}
              </option>
            ))}
          </select>

          <label htmlFor="tb-note" style={{ marginTop: 8, display: 'block' }}>
            Who they spoke to, and when
          </label>
          <input
            id="tb-note"
            type="text"
            maxLength={MAX_NOTE}
            value={note}
            placeholder="Told Diana on the phone, Nov 9 about 2pm"
            onChange={(e) => {
              setNote(e.target.value);
              setSure(false);
            }}
          />

          <p className="tiny" style={{ margin: '6px 0' }}>
            This is for booking messages only (pickup code, contract, reminders), not marketing. It only turns texts back
            on for {name}. Calls and email are not touched. It is written on the booking with your note.
            {kind === 'unsubscribed' ? ' They also need to reply START to our number before texts will arrive.' : ''}
          </p>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {!sure ? (
              <button
                type="button"
                className="btn small"
                disabled={pending || !way || note.trim().length < MIN_NOTE}
                onClick={() => setSure(true)}
              >
                Turn texts back on
              </button>
            ) : (
              <button type="button" className="btn primary small" disabled={pending} onClick={submit} autoFocus>
                {pending ? 'Working…' : `Yes, ${name} asked for this`}
              </button>
            )}
            <button
              type="button"
              className="btn ghost small"
              disabled={pending}
              onClick={() => {
                setOpen(false);
                setSure(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
