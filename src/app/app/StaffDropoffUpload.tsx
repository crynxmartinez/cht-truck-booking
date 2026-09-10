'use client';

import { useMemo, useState } from 'react';

type Kind = 'CARGO' | 'FUEL_GAUGE' | 'EXTERIOR' | 'OTHER';
type Source = 'STAFF_EMAIL' | 'STAFF_SMS' | 'STAFF_OTHER';

const GROUPS: Array<{ kind: Kind; label: string; hint: string }> = [
  { kind: 'CARGO', label: 'Cargo space', hint: 'Inside of the truck or empty cargo area' },
  { kind: 'FUEL_GAUGE', label: 'Fuel gauge', hint: 'Dashboard showing the return fuel level' },
  { kind: 'EXTERIOR', label: 'Exterior', hint: 'Damage or condition photos' },
  { kind: 'OTHER', label: 'Other', hint: 'Anything else sent with the return' },
];

const today = () => new Date().toISOString().slice(0, 10);

export function StaffDropoffUpload({
  bookingId,
  alreadySubmitted,
}: {
  bookingId: string;
  alreadySubmitted: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<Record<Kind, File[]>>({
    CARGO: [],
    FUEL_GAUGE: [],
    EXTERIOR: [],
    OTHER: [],
  });
  const [source, setSource] = useState<Source>('STAFF_EMAIL');
  const [receivedAt, setReceivedAt] = useState(today());
  const [uploadedBy, setUploadedBy] = useState('Diana Alsup');
  const [reportedTime, setReportedTime] = useState('');
  const [note, setNote] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  const selected = useMemo(
    () => GROUPS.flatMap((group) => files[group.kind].map((file) => ({ kind: group.kind, file }))),
    [files],
  );

  function choose(kind: Kind, list: FileList | null) {
    if (!list) return;
    setFiles((current) => ({ ...current, [kind]: [...current[kind], ...Array.from(list)] }));
    setError('');
  }

  function clear(kind: Kind) {
    setFiles((current) => ({ ...current, [kind]: [] }));
  }

  async function save(complete: boolean) {
    if (!selected.length) return setError('Choose at least one return photo.');
    if (!uploadedBy.trim()) return setError('Enter who is uploading these photos.');
    if (!receivedAt) return setError('Choose the date the photos were received.');
    if (complete && !reportedTime) return setError('Enter the time the truck was returned.');

    setBusy(true);
    setError('');
    const documentIds: string[] = [];

    try {
      for (let index = 0; index < selected.length; index += 1) {
        const item = selected[index];
        setProgress(`Preparing photo ${index + 1} of ${selected.length}…`);
        const converted = await toWebp(item.file);
        if (converted.size > 4 * 1024 * 1024) {
          throw new Error(`${item.file.name} is still over 4 MB. Try saving it as a photo instead of a scan.`);
        }

        const form = new FormData();
        form.set('file', converted);
        form.set('kind', item.kind);
        form.set('source', source);
        form.set('receivedAt', receivedAt);
        form.set('uploadedBy', uploadedBy.trim());
        form.set('staffNote', note.trim());

        setProgress(`Uploading photo ${index + 1} of ${selected.length}…`);
        const response = await fetch(`/api/admin/bookings/${bookingId}/dropoff-documents`, {
          method: 'POST',
          body: form,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `Could not upload ${item.file.name}.`);
        documentIds.push(result.id);
      }

      setProgress(complete ? 'Completing the return…' : 'Saving the activity record…');
      const response = await fetch(`/api/admin/bookings/${bookingId}/dropoff-finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentIds,
          uploadedBy: uploadedBy.trim(),
          note: note.trim(),
          reportedTime,
          overrideReason: overrideReason.trim(),
          complete,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not finish saving those photos.');

      setProgress(complete ? 'Return completed. Refreshing…' : 'Photos attached. Refreshing…');
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Those photos could not be saved.');
      setProgress(
        documentIds.length
          ? `${documentIds.length} photo${documentIds.length === 1 ? ' was' : 's were'} saved before the error. Refresh to see them.`
          : '',
      );
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="btn ghost small" onClick={() => setOpen(true)}>
        Upload return photos received another way
      </button>
    );
  }

  return (
    <div className="staff-upload">
      <div className="staff-upload-hd">
        <div>
          <b>Attach return photos</b>
          <p>Use this when the renter sent the evidence by email, SMS, or another channel.</p>
        </div>
        <button className="x" type="button" aria-label="Close uploader" onClick={() => setOpen(false)}>
          &times;
        </button>
      </div>

      <div className="staff-upload-meta">
        <label>
          Received through
          <select value={source} onChange={(event) => setSource(event.target.value as Source)} disabled={busy}>
            <option value="STAFF_EMAIL">Email</option>
            <option value="STAFF_SMS">SMS / text</option>
            <option value="STAFF_OTHER">Other</option>
          </select>
        </label>
        <label>
          Date received
          <input type="date" value={receivedAt} onChange={(event) => setReceivedAt(event.target.value)} disabled={busy} />
        </label>
        <label>
          Uploaded by
          <input value={uploadedBy} onChange={(event) => setUploadedBy(event.target.value)} disabled={busy} />
        </label>
        <label>
          Time returned
          <input type="time" value={reportedTime} onChange={(event) => setReportedTime(event.target.value)} disabled={busy} />
        </label>
      </div>

      <div className="staff-upload-groups">
        {GROUPS.map((group) => (
          <label className={files[group.kind].length ? 'staff-file has-files' : 'staff-file'} key={group.kind}>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
              multiple
              disabled={busy}
              onChange={(event) => {
                choose(group.kind, event.target.files);
                event.target.value = '';
              }}
            />
            <b>{group.label}</b>
            <small>
              {files[group.kind].length
                ? `${files[group.kind].length} selected · ${files[group.kind].map((file) => file.name).join(', ')}`
                : group.hint}
            </small>
            {files[group.kind].length ? (
              <button type="button" className="clear-files" onClick={(event) => { event.preventDefault(); clear(group.kind); }}>
                Clear
              </button>
            ) : null}
          </label>
        ))}
      </div>

      <label className="staff-note">
        Internal note <span>optional</span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Example: Received by email after the checklist link failed."
          disabled={busy}
        />
      </label>

      {!alreadySubmitted ? (
        <label className="staff-note">
          Override reason <span>only needed if required evidence is missing</span>
          <input
            value={overrideReason}
            onChange={(event) => setOverrideReason(event.target.value)}
            placeholder="Example: Fuel photo unavailable; renter confirmed tank was full."
            disabled={busy}
          />
        </label>
      ) : null}

      {error ? <div className="note alert">{error}</div> : null}
      {progress ? <div className="staff-progress">{progress}</div> : null}

      <div className="staff-upload-actions">
        <button className="btn ghost small" disabled={busy} onClick={() => save(false)}>
          {busy ? 'Saving…' : 'Upload only'}
        </button>
        {!alreadySubmitted ? (
          <button className="btn primary small" disabled={busy} onClick={() => save(true)}>
            {busy ? 'Saving…' : 'Upload and complete return'}
          </button>
        ) : (
          <span className="tiny">The return is already complete; these photos will be added as supporting evidence.</span>
        )}
      </div>
    </div>
  );
}

async function toWebp(file: File, maxDimension = 1600, quality = 0.82): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
    if (!blob) return file;
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.webp`, { type: 'image/webp' });
  } catch {
    // HEIC support varies by browser. The server gets another chance to decode
    // it; if it cannot, preserving the original is better than dropping it.
    return file;
  }
}
