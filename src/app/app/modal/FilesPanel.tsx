'use client';

import type { PanelProps } from './panel';

/** Photos and documents, and the PDF copy of the whole record. */
export function FilesPanel({ detail }: PanelProps) {
  const c = detail.card;
  return (
    <>
      <div className="sect" style={{ marginTop: 0 }}>Photos &amp; documents ({detail.documents.length})</div>
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

      <div className="sect">Record</div>
      <p className="tiny" style={{ marginTop: 0 }}>
        A PDF copy of this booking: details, signing record, messages and truck photos. Licence and insurance photos are not
        shown in it and lockbox codes are hidden, so it is safe to forward.
      </p>
      <a className="btn ghost small" href={`/api/admin/bookings/${c.id}/record`} download>
        Download record (PDF)
      </a>
    </>
  );
}
