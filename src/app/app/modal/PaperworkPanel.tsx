'use client';

import { useState } from 'react';
import { approveChecklistAction, approveContractAction } from '../actions';
import { StaffDropoffUpload } from '../StaffDropoffUpload';
import type { PanelProps } from './panel';

/** Agreements and checklists: who has signed, and the approvals that are waiting. */
export function PaperworkPanel({ detail, pending, run }: PanelProps) {
  const c = detail.card;
  // With several main admins, whoever approves says who they are. With one, nobody has to choose.
  const [approverChoice, setApproverChoice] = useState('');
  const approverId = detail.approvers.length === 1 ? detail.approvers[0].id : approverChoice;
  const mustChoose = detail.approvers.length > 1;
  const waitingOnApproval =
    detail.contracts.some((k) => k.status === 'SIGNED' && !k.counterSignedLabel) ||
    detail.checklists.some((k) => !k.counterSignedLabel && k.submitted);

  return (
    <>
      {mustChoose && waitingOnApproval ? (
        <div className="note" style={{ margin: '0 0 8px' }}>
          <label htmlFor="approver-choice">
            <b>Approving as</b>
          </label>{' '}
          <select id="approver-choice" value={approverChoice} onChange={(e) => setApproverChoice(e.target.value)} disabled={pending}>
            <option value="">Choose who you are…</option>
            {detail.approvers.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.hasSignature ? '' : ' (no signature on file)'}
              </option>
            ))}
          </select>
          <div className="tiny">Their signature is the one put on the agreement.</div>
        </div>
      ) : null}

      <div className="sect" style={{ marginTop: 0 }}>Contracts</div>
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
                <th>Approved</th>
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
                    {k.counterSignedLabel ? (
                      <span className="tiny">{k.counterSignedLabel}</span>
                    ) : k.status === 'SIGNED' ? (
                      <button
                        className="btn primary small"
                        disabled={pending || (mustChoose && !approverId)}
                        onClick={() => run(() => approveContractAction(k.id, approverId || undefined))}
                      >
                        Sign &amp; approve
                      </button>
                    ) : (
                      <span className="tiny">—</span>
                    )}
                  </td>
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
                <th>Signed off</th>
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
                    {k.counterSignedLabel ? (
                      <span className="tiny">{k.counterSignedLabel}</span>
                    ) : k.submittedLabel !== '—' && !k.submittedLabel.startsWith('opened') ? (
                      <button
                        className="btn primary small"
                        disabled={pending || (mustChoose && !approverId)}
                        onClick={() => run(() => approveChecklistAction(k.id, approverId || undefined))}
                      >
                        Sign off
                      </button>
                    ) : (
                      <span className="tiny">—</span>
                    )}
                  </td>
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
          Staff override: {detail.checklists.find((k) => k.overrideReason)?.overrideReason}
        </p>
      ) : null}

      {c.stage !== 'CANCELLED' && detail.checklists.some((k) => k.phase === 'DROPOFF') ? (
        <div style={{ marginTop: 12 }}>
          <StaffDropoffUpload bookingId={c.id} alreadySubmitted={Boolean(detail.checklists.find((k) => k.phase === 'DROPOFF')?.submitted)} />
        </div>
      ) : null}
    </>
  );
}
