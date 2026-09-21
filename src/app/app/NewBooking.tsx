'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { checkAvailability, createBooking, type ActionResult } from './actions';
import type { TruckOption } from './types';

type Avail = Awaited<ReturnType<typeof checkAvailability>>;

const pretty = (iso: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })
    .format(new Date(iso + 'T00:00:00Z'));

/**
 * Taking a booking over the phone.
 *
 * The shape follows the call: who they are, when they want it, which truck.
 * Everything else has a sensible default, because the person filling this in
 * is holding a phone in their other hand.
 */
export function NewBooking({
  trucks,
  defaultDate,
  defaultTruckId,
  defaultDays,
  onClose,
}: {
  trucks: TruckOption[];
  defaultDate?: string;
  defaultTruckId?: string;
  defaultDays: number;
  onClose: (created: boolean) => void;
}) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [pickupDate, setPickupDate] = useState(defaultDate ?? '');
  const [days, setDays] = useState(defaultDays);
  const [truckId, setTruckId] = useState(defaultTruckId ?? '');
  const [sendContract, setSendContract] = useState(true);
  const [documentsLater, setDocumentsLater] = useState(true);
  const [note, setNote] = useState('');

  const [avail, setAvail] = useState<Avail>(null);
  const [flash, setFlash] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const [, startPeek] = useTransition();
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !pending && onClose(false);
    document.addEventListener('keydown', esc);
    document.body.style.overflow = 'hidden';
    nameRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', esc);
      document.body.style.overflow = '';
    };
  }, [onClose, pending]);

  // Tell them what is free as they type the date, not after they submit.
  useEffect(() => {
    if (!pickupDate) {
      setAvail(null);
      return;
    }
    const t = setTimeout(() => {
      startPeek(async () => setAvail(await checkAvailability(pickupDate, days)));
    }, 300);
    return () => clearTimeout(t);
  }, [pickupDate, days]);

  const chosenFree = !truckId || Boolean(avail?.free.some((t) => t.id === truckId));
  const canSubmit =
    Boolean(fullName.trim() && email.trim() && phone.trim() && pickupDate) && days >= 1 && !pending;

  function submit() {
    start(async () => {
      try {
        const r = await createBooking({
          fullName, email, phone, pickupDate, days, truckId, sendContract, documentsLater, note,
        });
        setFlash(r);
        if (r.ok) setTimeout(() => onClose(true), 900);
      } catch {
        setFlash({ ok: false, error: 'That did not work. Try again.' });
      }
    });
  }

  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && !pending && onClose(false)}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="New booking" style={{ maxWidth: 560 }}>
        <div className="modal-hd">
          <div>
            <h2>New booking</h2>
            <div className="sub">For a booking taken over the phone or at the door.</div>
          </div>
          <button className="x" onClick={() => onClose(false)} aria-label="Close" disabled={pending}>
            &times;
          </button>
        </div>

        <div className="modal-bd">
          {flash ? (
            <div className={flash.ok ? 'note ok' : 'note alert'}>{flash.ok ? flash.message : flash.error}</div>
          ) : null}

          <div className="row">
            <label htmlFor="nb-name">
              Full name <em>*</em>
            </label>
            <input
              id="nb-name"
              ref={nameRef}
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Victor Barroso"
              autoComplete="off"
            />
          </div>

          <div className="row two">
            <div>
              <label htmlFor="nb-email">
                Email <em>*</em>
              </label>
              <input
                id="nb-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="them@example.com"
                autoComplete="off"
              />
            </div>
            <div>
              <label htmlFor="nb-phone">
                Mobile <em>*</em>
              </label>
              <input
                id="nb-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="562 556 8184"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="row two">
            <div>
              <label htmlFor="nb-date">
                Pickup date <em>*</em>
              </label>
              <input id="nb-date" type="date" value={pickupDate} onChange={(e) => setPickupDate(e.target.value)} />
            </div>
            <div>
              <label htmlFor="nb-days">Length (days)</label>
              <input
                id="nb-days"
                type="number"
                min={1}
                max={30}
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              />
            </div>
          </div>

          {avail ? (
            <div className={avail.free.length ? 'note info' : 'note alert'} style={{ marginTop: -4 }}>
              <div>
                <b>
                  {pretty(avail.window.start)} &rarr; {pretty(avail.window.end)}
                </b>{' '}
                &middot;{' '}
                {avail.free.length === 0
                  ? 'nothing free'
                  : `${avail.free.map((t) => `Truck ${t.code}`).join(' and ')} free`}
              </div>
              {avail.taken.map((t) => (
                <div key={t.code} className="tiny">
                  Truck {t.code} — {t.reason}
                </div>
              ))}
            </div>
          ) : null}

          <div className="row">
            <label htmlFor="nb-truck">Truck</label>
            <select id="nb-truck" value={truckId} onChange={(e) => setTruckId(e.target.value)}>
              <option value="">Whichever is free (A first)</option>
              {trucks.map((t) => (
                <option key={t.id} value={t.id}>
                  Truck {t.code}
                </option>
              ))}
            </select>
            {truckId && avail && !chosenFree ? (
              <div className="err">That truck is not free for those dates.</div>
            ) : null}
          </div>

          <div className="row">
            <label className="check" htmlFor="nb-send">
              <input
                id="nb-send"
                type="checkbox"
                checked={sendContract}
                onChange={(e) => setSendContract(e.target.checked)}
              />
              <span>
                Send the rental agreement now
                <br />
                <small className="tiny">They get the signing link by email and text straight away.</small>
              </span>
            </label>

            <label className="check" htmlFor="nb-docs">
              <input
                id="nb-docs"
                type="checkbox"
                checked={documentsLater}
                onChange={(e) => setDocumentsLater(e.target.checked)}
              />
              <span>
                Licence and insurance still to come
                <br />
                <small className="tiny">Flags the booking on Needs attention until you have them.</small>
              </span>
            </label>
          </div>

          <div className="row" style={{ marginBottom: 0 }}>
            <label htmlFor="nb-note">Note (optional)</label>
            <input
              id="nb-note"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Called in, wants the truck for a two-day move…"
            />
          </div>
        </div>

        <div className="modal-ft">
          <div className="spacer" />
          <button className="btn ghost" onClick={() => onClose(false)} disabled={pending}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit} disabled={!canSubmit}>
            {pending ? 'Creating…' : 'Create booking'}
          </button>
        </div>
      </div>
    </div>
  );
}
