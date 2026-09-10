'use client';

import { useEffect, useState, useTransition } from 'react';
import type { Stage } from '@prisma/client';
import { STAGE_META, STAGE_LABEL } from '@/lib/stages';
import type { ActionResult } from './actions';
import { addNote, cancel, clearFlags, moveStage, reopen, resend, switchTruck } from './actions';
import type { BookingDetail, TruckOption } from './types';
import { StaffDropoffUpload } from './StaffDropoffUpload';

const RESENDABLE: Array<{ key: string; label: string }> = [
  { key: 'contract_to_sign', label: 'Contract link' },
  { key: 'rental_confirmed', label: 'Confirmation' },
  { key: 'pickup_morning', label: 'Pickup + lockbox code' },
  { key: 'return_day', label: 'Return reminder' },
  { key: 'thank_you', label: 'Thank you' },
];

export function BookingModal({
  detail,
  trucks,
  onClose,
}: {
  detail: BookingDetail;
  trucks: TruckOption[];
  onClose: () => void;
}) {
  const c = detail.card;
  const [flash, setFlash] = useState<ActionResult | null>(null);
  const [note, setNote] = useState('');
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', esc);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  function run(fn: () => Promise<ActionResult>) {
    startTransition(async () => {
      try {
        setFlash(await fn());
      } catch {
        setFlash({ ok: false, error: 'That did not work. Try again.' });
      }
    });
  }

  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={`Booking ${c.reference}`}>
        <div className="modal-hd">
          <div>
            <h2>{c.name}</h2>
            <div className="sub">
              {c.reference} &middot; {STAGE_LABEL[c.stage]} &middot; booked {c.createdLabel}
            </div>
          </div>
          <button className="x" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        <div className="modal-bd">
          {flash ? (
            <div className={flash.ok ? 'note ok' : 'note alert'}>{flash.ok ? flash.message : flash.error}</div>
          ) : null}

          {c.overdue || c.rescheduleAsked || detail.reviewNote ? (
            <div className="note warn">
              {c.overdue ? <div>Truck was due back {c.returnLabel} and has not been returned.</div> : null}
              {c.rescheduleAsked ? <div>Renter replied asking to reschedule.</div> : null}
              {detail.reviewNote ? <div>Renter note: &ldquo;{detail.reviewNote}&rdquo;</div> : null}
              <button
                className="btn ghost small"
                style={{ marginTop: 8 }}
                disabled={pending}
                onClick={() => run(() => clearFlags(c.id))}
              >
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
                className={m.stage === c.stage ? 'btn primary small' : 'btn ghost small'}
                disabled={pending || m.stage === c.stage}
                onClick={() => run(() => moveStage(c.id, m.stage as Stage))}
                title={m.blurb}
              >
                {m.label}
              </button>
            ))}
          </div>

          {trucks.length > 1 ? (
            <>
              <div className="sect">Swap truck</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {trucks.map((t) => (
                  <button
                    key={t.id}
                    className={t.id === c.truckId ? 'btn primary small' : 'btn ghost small'}
                    disabled={pending || t.id === c.truckId}
                    onClick={() => run(() => switchTruck(c.id, t.id))}
                  >
                    Truck {t.code}
                  </button>
                ))}
              </div>
            </>
          ) : null}

          <div className="sect">Contracts</div>
          {detail.contracts.length === 0 ? (
            <p className="tiny">No contracts yet.</p>
          ) : (
            <div className="tablewrap">
              <table className="msgtable">
                <thead>
                  <tr>
                    <th>Document</th>
                    <th>Status</th>
                    <th>Signed</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {detail.contracts.map((k) => (
                    <tr key={k.id}>
                      <td>{k.type === 'RENTAL_AGREEMENT' ? 'Rental agreement' : 'Additional driver'}</td>
                      <td>{k.status.toLowerCase()}</td>
                      <td>{k.signedLabel}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {k.pdfUrl ? (
                          <a href={k.pdfUrl} target="_blank" rel="noreferrer">
                            PDF
                          </a>
                        ) : (
                          <a href={k.link} target="_blank" rel="noreferrer">
                            Open link
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="sect">Checklists</div>
          {detail.checklists.length === 0 ? (
            <p className="tiny">No checklists yet.</p>
          ) : (
            <div className="tablewrap">
              <table className="msgtable">
                <thead>
                  <tr>
                    <th>Phase</th>
                    <th>Submitted</th>
                    <th>Time</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {detail.checklists.map((k) => (
                    <tr key={k.phase}>
                      <td>{k.phase === 'PICKUP' ? 'Pickup' : 'Drop-off'}</td>
                      <td>
                        {k.submittedLabel}
                        {k.completionSource ? (
                          <small style={{ display: 'block', color: 'var(--faint)' }}>
                            {k.completionSource === 'STAFF' ? `staff · ${k.completedBy ?? 'ops'}` : 'renter'}
                          </small>
                        ) : null}
                      </td>
                      <td>{k.reportedTime ?? '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <a href={k.link} target="_blank" rel="noreferrer">
                          Open link
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {detail.checklists.some((k) => k.notes) ? (
            <p className="tiny" style={{ marginTop: 8 }}>
              {detail.checklists
                .filter((k) => k.notes)
                .map((k) => `${k.phase === 'PICKUP' ? 'Pickup' : 'Drop-off'} note: “${k.notes}”`)
                .join(' · ')}
            </p>
          ) : null}
          {detail.checklists.some((k) => k.overrideReason) ? (
            <p className="tiny" style={{ marginTop: 8, color: 'var(--warn)' }}>
              Staff override:{' '}
              {detail.checklists.find((k) => k.overrideReason)?.overrideReason}
            </p>
          ) : null}

          {c.stage !== 'CANCELLED' && detail.checklists.some((k) => k.phase === 'DROPOFF') ? (
            <div style={{ marginTop: 12 }}>
              <StaffDropoffUpload
                bookingId={c.id}
                alreadySubmitted={Boolean(detail.checklists.find((k) => k.phase === 'DROPOFF')?.submitted)}
              />
            </div>
          ) : null}

          <div className="sect">Photos &amp; documents ({detail.documents.length})</div>
          {detail.documents.length === 0 ? (
            <p className="tiny">Nothing uploaded yet.</p>
          ) : (
            <div className="docgrid">
              {detail.documents.map((d) => (
                <a
                  key={d.id}
                  href={d.url}
                  target="_blank"
                  rel="noreferrer"
                  title={`${d.kind} · ${d.phase}${d.uploadedBy ? ` · uploaded by ${d.uploadedBy}` : ''}`}
                >
                  {d.isImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={d.url} alt={d.kind} loading="lazy" />
                  ) : (
                    <div className="pdf">PDF</div>
                  )}
                  <div className="lbl">
                    <span>{d.kind.replace(/_/g, ' ').toLowerCase()}</span>
                    <small>
                      {d.phase.toLowerCase()} · {d.source === 'RENTER' ? 'renter' : d.source.replace('STAFF_', 'staff ').toLowerCase()}
                    </small>
                    {d.uploadedBy ? <small>by {d.uploadedBy}</small> : null}
                  </div>
                </a>
              ))}
            </div>
          )}

          <div className="sect">Resend a message</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {RESENDABLE.map((r) => (
              <button
                key={r.key}
                className="btn ghost small"
                disabled={pending}
                onClick={() => run(() => resend(c.id, r.key))}
              >
                {r.label}
              </button>
            ))}
          </div>

          <div className="sect">Messages sent</div>
          {detail.messages.length === 0 ? (
            <p className="tiny">Nothing sent yet.</p>
          ) : (
            <div className="tablewrap">
              <table className="msgtable">
                <thead>
                  <tr>
                    <th>Message</th>
                    <th>Via</th>
                    <th>Status</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.messages.map((m, i) => (
                    <tr key={i}>
                      <td>{m.template.replace(/_/g, ' ')}</td>
                      <td>{m.channel.toLowerCase()}</td>
                      <td style={m.status === 'FAILED' ? { color: 'var(--red)' } : undefined}>
                        {m.status.toLowerCase()}
                        {m.error ? ` — ${m.error.slice(0, 60)}` : ''}
                      </td>
                      <td>{m.sentLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

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

          <div className="sect">Add a note</div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything worth recording…" />
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
        </div>

        <div className="modal-ft">
          {c.stage === 'CANCELLED' ? (
            <button className="btn ghost" disabled={pending} onClick={() => run(() => reopen(c.id))}>
              Reopen booking
            </button>
          ) : (
            <button
              className="btn ghost"
              disabled={pending}
              onClick={() => {
                const reason = window.prompt('Why is this being cancelled?') ?? '';
                if (reason !== null && reason.trim()) run(() => cancel(c.id, reason));
              }}
            >
              Cancel booking
            </button>
          )}
          <div className="spacer" />
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
