'use client';

import { useState, useTransition } from 'react';
import { previewOfficeMessage, sendOfficeMessage, type ActionResult, type OfficePreviewResult } from './actions';

/**
 * Write to a renter by hand. Two steps on purpose: the first shows exactly
 * what will be sent and to which number and address; only the second sends.
 * Every message is logged on the booking like any other.
 */
export function SendMessage({
  bookingId,
  name,
  onResult,
}: {
  bookingId: string;
  name: string;
  onResult: (r: ActionResult) => void;
}) {
  const [text, setText] = useState('');
  const [subject, setSubject] = useState('');
  const [sms, setSms] = useState(true);
  const [email, setEmail] = useState(true);
  const [preview, setPreview] = useState<OfficePreviewResult | null>(null);
  const [pending, start] = useTransition();

  const input = { text, subject, sms, email };

  // Any change after a preview means it is no longer what was shown.
  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPreview(null);
  };

  function showPreview() {
    start(async () => {
      try {
        setPreview(await previewOfficeMessage(bookingId, input));
      } catch {
        setPreview({ ok: false, errors: ['That did not work. Try again.'] });
      }
    });
  }

  function send() {
    start(async () => {
      try {
        const result = await sendOfficeMessage(bookingId, input);
        onResult(result);
        if (result.ok) {
          setText('');
          setSubject('');
          setPreview(null);
        }
      } catch {
        onResult({ ok: false, error: 'That did not work. Try again.' });
      }
    });
  }

  return (
    <>
      <div className="sect">Send a message to {name}</div>
      <p className="tiny" style={{ marginTop: 0 }}>
        Sent exactly as you type it, so sign it yourself. You see it first and confirm before it goes. It is saved on
        this booking under Messages sent.
      </p>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', margin: '6px 0' }}>
        <label className="check">
          <input type="checkbox" checked={sms} onChange={(e) => edit(setSms)(e.target.checked)} />
          <span>Text</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={email} onChange={(e) => edit(setEmail)(e.target.checked)} />
          <span>Email</span>
        </label>
      </div>

      {email ? (
        <input
          type="text"
          value={subject}
          onChange={(e) => edit(setSubject)(e.target.value)}
          placeholder="Email subject"
          aria-label="Email subject"
          maxLength={150}
          style={{ width: '100%', marginBottom: 6 }}
        />
      ) : null}
      <textarea
        value={text}
        onChange={(e) => edit(setText)(e.target.value)}
        placeholder="Write your message…"
        aria-label="Message"
        rows={4}
      />
      {sms ? (
        <div className="tiny">
          {text.trim().length} characters{text.trim().length > 160 ? ' · a text this long is sent as more than one' : ''}
        </div>
      ) : null}

      {preview && !preview.ok ? (
        <div className="note alert" style={{ marginTop: 8 }}>
          {preview.errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </div>
      ) : null}

      {preview && preview.ok ? (
        <div className="note" style={{ marginTop: 8 }}>
          <b>This will be sent:</b>
          {preview.preview.recipients.map((r) => (
            <div key={r.channel} className="tiny">
              {r.channel === 'SMS' ? 'Text to' : 'Email to'} {r.address}
            </div>
          ))}
          {preview.preview.subject && preview.preview.recipients.some((r) => r.channel === 'EMAIL') ? (
            <div className="tiny">
              Subject: <b>{preview.preview.subject}</b>
            </div>
          ) : null}
          <div style={{ whiteSpace: 'pre-wrap', margin: '8px 0', padding: '8px 10px', background: 'var(--bg, #fff)', borderRadius: 6 }}>
            {preview.preview.text}
          </div>
          {preview.preview.warnings.map((w) => (
            <div key={w} className="tiny" style={{ color: 'var(--warn, #8f5e0a)' }}>
              {w}
            </div>
          ))}
        </div>
      ) : null}

      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
        {preview && preview.ok ? (
          <button className="btn primary small" disabled={pending} onClick={send}>
            {pending ? 'Sending…' : 'Send now'}
          </button>
        ) : (
          <button className="btn small" disabled={pending || !text.trim()} onClick={showPreview}>
            {pending ? 'Checking…' : 'Preview'}
          </button>
        )}
        {preview ? (
          <button className="btn ghost small" disabled={pending} onClick={() => setPreview(null)}>
            Edit
          </button>
        ) : null}
      </div>
    </>
  );
}
