'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The pickup / drop-off checklist, rebuilt from the six original screens.
 *
 * One component serves both phases — the wording swaps and the fuel-gauge
 * screen only appears where it is configured. Progress is saved to the server
 * as they go, so losing signal on the last upload does not cost them the form.
 */

export type Step = {
  id: string;
  kind: 'intro' | 'basic' | 'lockbox' | 'upload' | 'submit';
  title: string;
  body?: string[];
  uploads?: Array<{ key: string; label: string; hint: string; required: boolean }>;
};

export type ChecklistFlowProps = {
  token: string;
  phase: 'PICKUP' | 'DROPOFF';
  steps: Step[];
  lockboxCode: string;
  truckCode: string;
  pickupAddress: string;
  reference: string;
  prefill: { firstName: string; lastName: string; email: string; phone: string };
  savedDraft: Record<string, unknown> | null;
  alreadySubmitted: boolean;
};

type Uploaded = { id: string; name: string; bytes: number };

const REMINDER = 'Your answers save as you go, so it is safe to close this page and come back.';

export function ChecklistFlow(props: ChecklistFlowProps) {
  const isReturn = props.phase === 'DROPOFF';
  const saved = (props.savedDraft ?? {}) as Record<string, any>;

  const [i, setI] = useState(0);
  const [done, setDone] = useState(props.alreadySubmitted);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [basic, setBasic] = useState({
    firstName: saved.firstName ?? props.prefill.firstName ?? '',
    lastName: saved.lastName ?? props.prefill.lastName ?? '',
    email: saved.email ?? props.prefill.email ?? '',
    phone: saved.phone ?? props.prefill.phone ?? '',
    reportedTime: saved.reportedTime ?? '',
  });
  const [notes, setNotes] = useState<string>(saved.notes ?? '');
  const [files, setFiles] = useState<Record<string, Uploaded[]>>(saved.files ?? {});

  const step = props.steps[i];
  const last = i === props.steps.length - 1;

  // ---- autosave ----------------------------------------------------------
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persist = useCallback(
    (draft: Record<string, unknown>) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        fetch(`/api/checklist/${props.token}/draft`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ draft }),
          keepalive: true,
        }).catch(() => undefined);
      }, 700);
    },
    [props.token],
  );

  useEffect(() => {
    if (done) return;
    persist({ ...basic, notes, files });
  }, [basic, notes, files, done, persist]);

  // ---- validation --------------------------------------------------------
  function validateStep(): boolean {
    const e: Record<string, string> = {};
    if (step.kind === 'basic') {
      if (basic.firstName.trim().length < 2) e.firstName = 'Please enter your first name.';
      if (basic.lastName.trim().length < 2) e.lastName = 'Please enter your last name.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(basic.email.trim())) e.email = 'Please enter a valid email.';
      if (basic.phone.replace(/\D/g, '').length < 10) e.phone = 'Please enter your mobile number.';
      if (!basic.reportedTime) e.reportedTime = isReturn ? 'What time did you return it?' : 'What time did you pick it up?';
    }
    if (step.kind === 'upload') {
      for (const u of step.uploads ?? []) {
        if (u.required && !(files[u.key]?.length > 0)) e[u.key] = 'This photo is required.';
      }
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function next() {
    if (!validateStep()) return;
    setErrors({});
    setI((n) => Math.min(n + 1, props.steps.length - 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function prev() {
    setErrors({});
    setI((n) => Math.max(n - 1, 0));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function submit() {
    // Re-check every earlier step, not just this one.
    for (const s of props.steps) {
      if (s.kind === 'upload') {
        for (const u of s.uploads ?? []) {
          if (u.required && !(files[u.key]?.length > 0)) {
            setFail(`Please add the ${u.label.toLowerCase()} photo before submitting.`);
            const idx = props.steps.indexOf(s);
            setI(idx);
            return;
          }
        }
      }
    }

    setBusy(true);
    setFail('');
    try {
      const res = await fetch(`/api/checklist/${props.token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...basic, notes }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Could not submit your checklist.');
      setDone(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setFail(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="card-bd center" style={{ padding: '40px 24px 44px' }}>
        <div className="tick">&#10003;</div>
        <h1>{isReturn ? 'Return checklist received' : 'You are good to go'}</h1>
        <p className="lede">
          {isReturn
            ? 'Thanks for completing the Cory Home Team truck rental checklist. We have everything we need — if anything else comes up we will email you.'
            : 'Your photos are on file. Drive safe, and remember the truck is due back with the fuel at the level you found it.'}
        </p>
        <div className="recap">
          <div>
            <span>Reference</span>
            <b>{props.reference}</b>
          </div>
          <div>
            <span>Truck</span>
            <b>{props.truckCode}</b>
          </div>
          <div>
            <span>{isReturn ? 'Returned' : 'Picked up'}</span>
            <b>{basic.reportedTime || '—'}</b>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="card-bd">
        {fail ? <div className="note alert">{fail}</div> : null}

        <h1 className="center red" style={{ fontSize: 18 }}>
          {step.title}
        </h1>

        {step.kind === 'intro' ? (
          <div style={{ marginTop: 18 }}>
            {step.body?.map((p, k) => (
              <p key={k}>{p}</p>
            ))}
            <p className="reminder">
              <b>Good to know:</b> {REMINDER}
            </p>
          </div>
        ) : null}

        {step.kind === 'basic' ? (
          <div style={{ marginTop: 18 }}>
            <div className="row two">
              <div>
                <label htmlFor="fn">First Name <em>*</em></label>
                <input
                  id="fn"
                  type="text"
                  value={basic.firstName}
                  onChange={(e) => setBasic((p) => ({ ...p, firstName: e.target.value }))}
                  aria-invalid={!!errors.firstName}
                />
                {errors.firstName ? <div className="err">{errors.firstName}</div> : null}
              </div>
              <div>
                <label htmlFor="ln">Last Name <em>*</em></label>
                <input
                  id="ln"
                  type="text"
                  value={basic.lastName}
                  onChange={(e) => setBasic((p) => ({ ...p, lastName: e.target.value }))}
                  aria-invalid={!!errors.lastName}
                />
                {errors.lastName ? <div className="err">{errors.lastName}</div> : null}
              </div>
            </div>
            <div className="row">
              <label htmlFor="ph">Phone <em>*</em></label>
              <input
                id="ph"
                type="tel"
                value={basic.phone}
                onChange={(e) => setBasic((p) => ({ ...p, phone: e.target.value }))}
                aria-invalid={!!errors.phone}
              />
              {errors.phone ? <div className="err">{errors.phone}</div> : null}
            </div>
            <div className="row">
              <label htmlFor="em">Email <em>*</em></label>
              <input
                id="em"
                type="email"
                value={basic.email}
                onChange={(e) => setBasic((p) => ({ ...p, email: e.target.value }))}
                aria-invalid={!!errors.email}
              />
              {errors.email ? <div className="err">{errors.email}</div> : null}
            </div>
            <div className="row">
              <label htmlFor="tm">{isReturn ? 'Time Returned' : 'Time Picked Up'} <em>*</em></label>
              <input
                id="tm"
                type="time"
                value={basic.reportedTime}
                onChange={(e) => setBasic((p) => ({ ...p, reportedTime: e.target.value }))}
                aria-invalid={!!errors.reportedTime}
              />
              {errors.reportedTime ? <div className="err">{errors.reportedTime}</div> : null}
            </div>
            <p className="reminder">
              <b>Good to know:</b> {REMINDER}
            </p>
          </div>
        ) : null}

        {step.kind === 'lockbox' ? (
          <div style={{ marginTop: 18 }}>
            <ol className="steps-plain" style={{ paddingLeft: 20, lineHeight: 2 }}>
              <li>Open the lock box cover to reveal the keypad.</li>
              <li>
                Type in <b className="red">{props.lockboxCode}</b> (each number should hear a click)
              </li>
              <li>Turn black dial at top counter clockwise</li>
            </ol>
            <p>
              <b>Should you make a mistake, click the C and start again.</b>
            </p>
            <p className="tiny">
              The lockbox is on the driver&rsquo;s side window of Truck {props.truckCode}.
              {isReturn ? ' Put the keys back in the lockbox when you are done.' : ''}
            </p>
            <p className="reminder">
              <b>Good to know:</b> {REMINDER}
            </p>
          </div>
        ) : null}

        {step.kind === 'upload' ? (
          <div style={{ marginTop: 18 }}>
            {step.body?.map((p, k) => (
              <p key={k}>{p}</p>
            ))}
            {step.uploads?.map((u) => (
              <div className="row" key={u.key}>
                <label>
                  {u.label} {u.required ? <em>*</em> : null}
                </label>
                <UploadSlot
                  token={props.token}
                  slotKey={u.key}
                  hint={u.hint}
                  items={files[u.key] ?? []}
                  onChange={(items) => {
                    setFiles((p) => ({ ...p, [u.key]: items }));
                    setErrors((p) => ({ ...p, [u.key]: '' }));
                  }}
                />
                {errors[u.key] ? <div className="err">{errors[u.key]}</div> : null}
              </div>
            ))}
            <p className="reminder">
              <b>Good to know:</b> {REMINDER}
            </p>
          </div>
        ) : null}

        {step.kind === 'submit' ? (
          <div style={{ marginTop: 18 }}>
            {step.body?.map((p, k) => (
              <p key={k}>{p}</p>
            ))}
            <div className="row" style={{ marginTop: 18 }}>
              <label htmlFor="nt">Anything we should know? (optional)</label>
              <textarea
                id="nt"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={isReturn ? 'Warning light, new scratch, low fuel…' : 'Anything already damaged, missing pads…'}
              />
            </div>
          </div>
        ) : null}
      </div>

      <div className="card-ft">
        {i > 0 ? (
          <button type="button" className="btn ghost" onClick={prev}>
            &larr; Prev
          </button>
        ) : null}
        <div className="spacer" />
        {last ? (
          <button type="button" className="btn primary" onClick={submit} disabled={busy}>
            {busy ? 'Submitting…' : 'Submit'}
          </button>
        ) : (
          <button type="button" className="btn primary" onClick={next}>
            Next &rarr;
          </button>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- uploads

function UploadSlot({
  token,
  slotKey,
  hint,
  items,
  onChange,
}: {
  token: string;
  slotKey: string;
  hint: string;
  items: Uploaded[];
  onChange: (items: Uploaded[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ name: string; pct: number; error?: string } | null>(null);

  async function handle(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    setPending({ name: file.name, pct: 15 });

    try {
      if (file.size > 30 * 1024 * 1024) throw new Error('That file is enormous — take a photo instead of scanning.');
      const out = await toWebp(file);
      // Vercel caps the request body at 4.5 MB. A converted photo is ~200 KB;
      // this only trips on a PDF or an image the browser could not re-encode.
      if (out.size > 4 * 1024 * 1024) {
        throw new Error('Still too large after compressing. Try a photo rather than a PDF.');
      }
      setPending({ name: file.name, pct: 45 });

      const fd = new FormData();
      fd.append('file', out, out.name);
      fd.append('slot', slotKey);

      const res = await fetch(`/api/checklist/${token}/upload`, { method: 'POST', body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Upload failed.');

      onChange([...items, { id: j.id, name: out.name, bytes: j.bytes ?? out.size }]);
      setPending(null);
    } catch (err) {
      setPending({ name: file.name, pct: 0, error: err instanceof Error ? err.message : 'Upload failed.' });
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <>
      {items.length ? (
        <div className="thumbs" style={{ marginBottom: 8 }}>
          {items.map((it, idx) => (
            <div className="thumb" key={it.id}>
              <div className="meta">
                <b>{it.name}</b>
                <small>{Math.round(it.bytes / 1024)} KB · uploaded</small>
              </div>
              <button
                type="button"
                title="Remove"
                onClick={() => onChange(items.filter((_, n) => n !== idx))}
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {pending ? (
        <div className="thumb" style={{ marginBottom: 8 }}>
          <div className="meta">
            <b>{pending.name}</b>
            <small>{pending.error ?? 'Uploading…'}</small>
            <div className="bar">
              <i style={{ width: `${pending.pct}%` }} />
            </div>
          </div>
          {pending.error ? (
            <button type="button" title="Dismiss" onClick={() => setPending(null)}>
              &times;
            </button>
          ) : null}
        </div>
      ) : null}

      <button type="button" className="drop" onClick={() => inputRef.current?.click()}>
        <b>Tap to add a photo</b>
        <small>{hint}</small>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        capture="environment"
        hidden
        onChange={(e) => handle(e.target.files)}
      />
    </>
  );
}

/** Downscale and re-encode in the browser. Falls back to the original file. */
async function toWebp(file: File, maxDim = 1600, quality = 0.82): Promise<File> {
  if (!/^image\//.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/webp', quality));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp' });
  } catch {
    return file;
  }
}
