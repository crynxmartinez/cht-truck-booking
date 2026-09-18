'use client';

import { useState, useTransition } from 'react';
import { SignaturePad } from '@/components/SignaturePad';
import { removeRecipient, saveRecipient, saveRecipientSignature, type ActionResult } from '../actions';

export type RecipientRow = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: 'MAIN_ADMIN' | 'ADMIN';
  notifyEmail: boolean;
  notifySms: boolean;
  active: boolean;
  hasSignature: boolean;
  ghlLinked: boolean;
};

type Draft = Omit<RecipientRow, 'id' | 'hasSignature' | 'ghlLinked'> & { id?: string };

const BLANK: Draft = {
  name: '', email: '', phone: '',
  role: 'ADMIN', notifyEmail: true, notifySms: true, active: true,
};

export function RecipientManager({ rows }: { rows: RecipientRow[] }) {
  const [flash, setFlash] = useState<ActionResult | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [signFor, setSignFor] = useState<RecipientRow | null>(null);
  const [sig, setSig] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const mainAdmin = rows.find((r) => r.role === 'MAIN_ADMIN' && r.active);

  function run(fn: () => Promise<ActionResult>, after?: () => void) {
    start(async () => {
      const r = await fn();
      setFlash(r);
      if (r.ok) after?.();
    });
  }

  return (
    <>
      {flash ? <div className={flash.ok ? 'note ok' : 'note alert'}>{flash.ok ? flash.message : flash.error}</div> : null}

      {!mainAdmin ? (
        <div className="note alert">
          <b>Nobody is set as main admin</b>
          Approvals are blocked until somebody is — bookings will sit in &ldquo;Needs your signature&rdquo; and no
          renter gets confirmed.
        </div>
      ) : !mainAdmin.hasSignature ? (
        <div className="note warn">
          <b>{mainAdmin.name} has no signature on file</b>
          Approvals are blocked until one is added. Use <b>Add signature</b> on their row.
        </div>
      ) : null}

      <div className="panel">
        <h2>Who gets notified</h2>
        <div className="hint">
          Everyone active here receives every alert. Only the <b>main admin</b> signs the paperwork — the rest are
          notified only.
        </div>

        <div className="tablewrap">
          <table className="datatable">
            <thead>
              <tr>
                <th>Person</th>
                <th>Role</th>
                <th>Channels</th>
                <th>Signature</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={r.active ? undefined : { opacity: 0.5 }}>
                  <td>
                    <b>{r.name}</b>
                    <br />
                    <span className="tiny">
                      {r.email} · {r.phone}
                    </span>
                  </td>
                  <td>
                    {r.role === 'MAIN_ADMIN' ? (
                      <span className="tag red">Main admin</span>
                    ) : (
                      <span className="tag">Admin</span>
                    )}
                    {!r.active ? (
                      <>
                        {' '}
                        <span className="tag">paused</span>
                      </>
                    ) : null}
                  </td>
                  <td className="tiny">
                    {r.notifyEmail ? 'email' : ''}
                    {r.notifyEmail && r.notifySms ? ' + ' : ''}
                    {r.notifySms ? 'SMS' : ''}
                    {!r.notifyEmail && !r.notifySms ? '— none' : ''}
                  </td>
                  <td>
                    {r.role !== 'MAIN_ADMIN' ? (
                      <span className="tiny">not needed</span>
                    ) : r.hasSignature ? (
                      <span className="tag green">on file</span>
                    ) : (
                      <span className="tag red">missing</span>
                    )}
                  </td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <button
                      className="btn ghost small"
                      onClick={() => setDraft({ ...r })}
                      disabled={pending}
                    >
                      Edit
                    </button>{' '}
                    {r.role === 'MAIN_ADMIN' ? (
                      <button className="btn ghost small" onClick={() => { setSignFor(r); setSig(null); }} disabled={pending}>
                        {r.hasSignature ? 'Replace signature' : 'Add signature'}
                      </button>
                    ) : (
                      <button
                        className="btn ghost small"
                        onClick={() => {
                          if (window.confirm(`Remove ${r.name} from the notification list?`)) {
                            run(() => removeRecipient(r.id));
                          }
                        }}
                        disabled={pending}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="tiny">
                    Nobody on the list — no alerts are going anywhere.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <button className="btn primary small" style={{ marginTop: 14 }} onClick={() => setDraft({ ...BLANK })} disabled={pending}>
          + Add someone
        </button>
      </div>

      {draft ? (
        <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && setDraft(null)}>
          <div className="modal" style={{ maxWidth: 520 }}>
            <div className="modal-hd">
              <div>
                <h2>{draft.id ? 'Edit person' : 'Add someone'}</h2>
                <div className="sub">They are matched to a GoHighLevel contact by email.</div>
              </div>
              <button className="x" onClick={() => setDraft(null)} aria-label="Close">
                &times;
              </button>
            </div>
            <div className="modal-bd">
              <div className="row">
                <label htmlFor="rn">Name</label>
                <input id="rn" type="text" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>
              <div className="row two">
                <div>
                  <label htmlFor="re">Email</label>
                  <input id="re" type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="rp">Mobile</label>
                  <input id="rp" type="tel" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
                </div>
              </div>
              <div className="row">
                <label htmlFor="rr">Role</label>
                <select id="rr" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as Draft['role'] })}>
                  <option value="ADMIN">Admin — notified only</option>
                  <option value="MAIN_ADMIN">Main admin — signs the paperwork</option>
                </select>
                {draft.role === 'MAIN_ADMIN' && mainAdmin && mainAdmin.id !== draft.id ? (
                  <div className="tiny" style={{ marginTop: 6, color: 'var(--warn)' }}>
                    {mainAdmin.name} is main admin today and will be moved to Admin.
                  </div>
                ) : null}
              </div>
              <label className="check">
                <input type="checkbox" checked={draft.notifyEmail} onChange={(e) => setDraft({ ...draft, notifyEmail: e.target.checked })} />
                <span>Email alerts</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={draft.notifySms} onChange={(e) => setDraft({ ...draft, notifySms: e.target.checked })} />
                <span>
                  Text alerts <span className="tiny">— overdue and reschedule always text regardless</span>
                </span>
              </label>
              <label className="check">
                <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
                <span>Active</span>
              </label>
            </div>
            <div className="modal-ft">
              <div className="spacer" />
              <button className="btn ghost" onClick={() => setDraft(null)} disabled={pending}>
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={pending}
                onClick={() => run(() => saveRecipient(draft), () => setDraft(null))}
              >
                {pending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {signFor ? (
        <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && setSignFor(null)}>
          <div className="modal" style={{ maxWidth: 520 }}>
            <div className="modal-hd">
              <div>
                <h2>{signFor.name}&rsquo;s signature</h2>
                <div className="sub">Drawn once, then stamped on every approval.</div>
              </div>
              <button className="x" onClick={() => setSignFor(null)} aria-label="Close">
                &times;
              </button>
            </div>
            <div className="modal-bd">
              <p className="tiny">
                This appears on the rental agreement beside the renter&rsquo;s signature, and on the dispatch and
                return reports. Each approval is still a deliberate click, recorded with a timestamp.
              </p>
              <SignaturePad defaultName={signFor.name} onChange={(data) => setSig(data)} />
            </div>
            <div className="modal-ft">
              <div className="spacer" />
              <button className="btn ghost" onClick={() => setSignFor(null)} disabled={pending}>
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={pending || !sig}
                onClick={() => run(() => saveRecipientSignature(signFor.id, sig!), () => setSignFor(null))}
              >
                {pending ? 'Saving…' : 'Save signature'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
