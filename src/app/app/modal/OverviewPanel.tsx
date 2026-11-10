'use client';

import { useState } from 'react';
import type { Stage } from '@prisma/client';
import { STAGE_META } from '@/lib/stages';
import { changeDates, clearFlags, switchTruck } from '../actions';
import type { PanelProps } from './panel';

/** Who and when, what needs attention, and the ways to change the booking: stage, dates, truck. */
export function OverviewPanel({ detail, stage, pending, run, moveTo }: PanelProps) {
  const c = detail.card;
  const [dates, setDates] = useState<{ start: string; days: number } | null>(null);

  return (
    <>
      {c.overdue || c.rescheduleAsked || detail.reviewNote ? (
        <div className="note warn">
          {c.overdue ? <div>Truck was due back {c.returnLabel} and has not been returned.</div> : null}
          {c.rescheduleAsked ? <div>Renter replied asking to reschedule.</div> : null}
          {detail.reviewNote ? <div>Renter note: &ldquo;{detail.reviewNote}&rdquo;</div> : null}
          <button className="btn ghost small" style={{ marginTop: 8 }} disabled={pending} onClick={() => run(() => clearFlags(c.id))}>
            Mark handled
          </button>
        </div>
      ) : null}

      <dl className="kv">
        <dt>Truck</dt>
        <dd>{c.truckCode ? `Truck ${c.truckCode}` : 'Not assigned'}</dd>
        <dt>Pickup</dt>
        <dd>{c.pickupLabel}</dd>
        <dt>Due back</dt>
        <dd>{c.returnLabel}</dd>
        <dt>Email</dt>
        <dd>
          <a href={`mailto:${c.email}`}>{c.email}</a>
        </dd>
        <dt>Phone</dt>
        <dd>
          <a href={`tel:${c.phone}`}>{c.phone}</a>
        </dd>
        {detail.additionalDriverName ? (
          <>
            <dt>Additional driver</dt>
            <dd>
              {detail.additionalDriverName}
              {detail.additionalDriverContact ? ` · ${detail.additionalDriverContact}` : ''}
            </dd>
          </>
        ) : null}
      </dl>

      <div className="sect">Move to stage</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {STAGE_META.map((m) => (
          <button
            key={m.stage}
            className={m.stage === stage ? 'btn primary small' : 'btn ghost small'}
            disabled={pending || m.stage === stage}
            onClick={() => run(() => moveTo(m.stage as Stage))}
            title={m.blurb}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="sect">Dates</div>
      {dates ? (
        <div className="note info">
          <div className="row two" style={{ marginBottom: 10 }}>
            <div>
              <label htmlFor="nd">New pickup date</label>
              <input id="nd" type="date" value={dates.start} onChange={(e) => setDates({ ...dates, start: e.target.value })} />
            </div>
            <div>
              <label htmlFor="nl">Length (days)</label>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {[1, 2, 3].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`btn small ${dates.days === n ? 'primary' : 'ghost'}`}
                    aria-pressed={dates.days === n}
                    onClick={() => setDates({ ...dates, days: n })}
                  >
                    {n}
                  </button>
                ))}
                <input
                  id="nl"
                  type="number"
                  min={1}
                  max={30}
                  value={dates.days}
                  onChange={(e) => setDates({ ...dates, days: Number(e.target.value) })}
                  style={{ width: 72 }}
                />
              </div>
            </div>
          </div>
          <div className="tiny" style={{ marginBottom: 10 }}>
            A shorter length frees the later days for other bookings. The renter is emailed and texted about the new dates automatically.
          </div>
          <button className="btn ghost small" onClick={() => setDates(null)} disabled={pending}>
            Cancel
          </button>{' '}
          <button
            className="btn primary small"
            disabled={pending || !dates.start}
            onClick={() => {
              const reason = window.prompt('Why is it moving? (shown in the activity log)') ?? '';
              run(async () => {
                const r = await changeDates(c.id, dates.start, dates.days, reason);
                if (r.ok) setDates(null);
                return r;
              });
            }}
          >
            Move booking
          </button>
        </div>
      ) : (
        <button className="btn ghost small" disabled={pending} onClick={() => setDates({ start: detail.pickupIso, days: detail.rentalDays })}>
          Change dates
        </button>
      )}

      {/* Empty unless accepted and pickup day has not arrived — the rule is
          decided on the server, so this never offers what it would refuse. */}
      {detail.swap.length > 0 ? (
        <>
          <div className="sect">Move to the other truck</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {detail.swap.map((t) => (
              <button
                key={t.id}
                className="btn ghost small"
                disabled={pending || !t.free}
                onClick={() => {
                  const from = c.truckCode ? `Truck ${c.truckCode}` : 'no truck';
                  if (window.confirm(`Move ${c.name} from ${from} to Truck ${t.code}?\n\nThey will be told by text and email.`)) {
                    run(() => switchTruck(c.id, t.id));
                  }
                }}
              >
                Move to Truck {t.code}
              </button>
            ))}
          </div>
          {detail.swap
            .filter((t) => !t.free)
            .map((t) => (
              <p key={t.id} className="tiny" style={{ marginTop: 8 }}>
                Truck {t.code} is out on these dates — {t.note}.
              </p>
            ))}
          <p className="tiny" style={{ marginTop: 8 }}>
            The renter is told. If they have already signed, their agreement still lists the original truck&rsquo;s plate.
          </p>
        </>
      ) : null}
    </>
  );
}
