'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { PLACEHOLDERS, type Wording } from '@/lib/wording-fill';
import { previewWordingAction, resetWordingAction, saveWordingAction, type WordingPreview, type WordingResult } from './actions';

export type VersionRow = { at: string; by: string; action: 'edited' | 'put back'; wording: Wording | null };

type Field = keyof Wording;

/**
 * Edit what one message says. The text starts as today's wording with the
 * parts that change per renter shown as {placeholders}. An edit that loses a
 * placeholder the message needs (the sign link, the lockbox code) is refused
 * when you press Save.
 */
export function WordingEditor({
  messageKey,
  current,
  builtIn,
  edited,
  history,
}: {
  messageKey: string;
  current: Wording;
  builtIn: Wording;
  edited: boolean;
  history: VersionRow[];
}) {
  const [w, setW] = useState<Wording>(current);
  const [focus, setFocus] = useState<Field>('sms');
  const [preview, setPreview] = useState<WordingPreview | null>(null);
  const [result, setResult] = useState<WordingResult | null>(null);
  const [pending, start] = useTransition();
  const refs = { subject: useRef<HTMLInputElement>(null), sms: useRef<HTMLTextAreaElement>(null), email: useRef<HTMLTextAreaElement>(null) };

  // After a save or a put-back the page re-renders with what is now stored.
  const stored = JSON.stringify(current);
  useEffect(() => {
    setW(current);
    setPreview(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored]);

  const dirty = w.subject !== current.subject || w.sms !== current.sms || w.email !== current.email;

  const change = (field: Field, value: string) => {
    setW({ ...w, [field]: value });
    setPreview(null);
    setResult(null);
  };

  function insert(name: string) {
    const token = `{${name}}`;
    const el = refs[focus].current;
    const start0 = el?.selectionStart ?? w[focus].length;
    const end0 = el?.selectionEnd ?? start0;
    const next = w[focus].slice(0, start0) + token + w[focus].slice(end0);
    change(focus, next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start0 + token.length, start0 + token.length);
    });
  }

  const run = (fn: () => Promise<void>) =>
    start(async () => {
      try {
        await fn();
      } catch {
        setResult({ ok: false, errors: ['That did not work. Try again.'] });
      }
    });

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--line, #e4e5e7)' }}>
      <b>Change the wording</b>
      {edited ? <span className="tag amber" style={{ marginLeft: 8 }}>Edited</span> : null}
      <div className="tiny" style={{ margin: '4px 0 8px' }}>
        Words in curly brackets, like {'{firstName}'}, are filled in for each renter. Keep the ones this message needs.
        This replaces the whole message for everyone from now on.
      </div>

      <label className="tiny" htmlFor={`${messageKey}-subject`}>Email subject</label>
      <input
        id={`${messageKey}-subject`}
        ref={refs.subject}
        type="text"
        value={w.subject}
        maxLength={150}
        onFocus={() => setFocus('subject')}
        onChange={(e) => change('subject', e.target.value)}
        style={{ width: '100%', marginBottom: 8 }}
      />

      <label className="tiny" htmlFor={`${messageKey}-sms`}>Text message ({w.sms.trim().length} characters)</label>
      <textarea
        id={`${messageKey}-sms`}
        ref={refs.sms}
        value={w.sms}
        rows={4}
        onFocus={() => setFocus('sms')}
        onChange={(e) => change('sms', e.target.value)}
      />

      <label className="tiny" htmlFor={`${messageKey}-email`}>Email</label>
      <textarea
        id={`${messageKey}-email`}
        ref={refs.email}
        value={w.email}
        rows={12}
        onFocus={() => setFocus('email')}
        onChange={(e) => change('email', e.target.value)}
      />

      <details style={{ margin: '8px 0' }}>
        <summary className="tiny" style={{ cursor: 'pointer' }}>
          Placeholders you can use (click one to put it in the box you were typing in)
        </summary>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          {PLACEHOLDERS.map((p) => (
            <button
              key={p.name}
              type="button"
              className="btn ghost small"
              title={`${p.label}. For example: ${p.example}`}
              onClick={() => insert(p.name)}
            >
              {`{${p.name}}`}
            </button>
          ))}
        </div>
      </details>

      {result ? (
        <div className={result.ok ? 'note ok' : 'note alert'} role="status">
          {result.ok ? result.message : result.errors.map((e) => <div key={e}>{e}</div>)}
        </div>
      ) : null}

      {preview && !preview.ok ? (
        <div className="note alert">{preview.errors.map((e) => <div key={e}>{e}</div>)}</div>
      ) : null}

      {preview && preview.ok ? (
        <div className="note">
          <b>This is how it reads for a sample renter</b>
          <div className="tiny">Subject</div>
          <div style={{ whiteSpace: 'pre-wrap', marginBottom: 6 }}>{preview.rendered.subject}</div>
          <div className="tiny">Text message</div>
          <div style={{ whiteSpace: 'pre-wrap', marginBottom: 6 }}>{preview.rendered.sms}</div>
          <div className="tiny">Email</div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{preview.rendered.email}</div>
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <button
          className="btn small"
          type="button"
          disabled={pending}
          onClick={() => run(async () => setPreview(await previewWordingAction(messageKey, w)))}
        >
          Preview
        </button>
        <button
          className="btn primary small"
          type="button"
          disabled={pending || !dirty}
          onClick={() => run(async () => setResult(await saveWordingAction(messageKey, w)))}
        >
          {pending ? 'Saving…' : 'Save this wording'}
        </button>
        {dirty ? (
          <button className="btn ghost small" type="button" disabled={pending} onClick={() => { setW(current); setPreview(null); setResult(null); }}>
            Discard changes
          </button>
        ) : null}
        <button
          className="btn ghost small"
          type="button"
          disabled={pending}
          onClick={() => setW(builtIn)}
          title="Fill the boxes with the original wording. Press Save to use it."
        >
          Load the original
        </button>
        {edited ? (
          <button
            className="btn ghost small"
            type="button"
            disabled={pending}
            onClick={() => {
              if (window.confirm('Go back to the original wording for everyone?')) {
                run(async () => setResult(await resetWordingAction(messageKey)));
              }
            }}
          >
            Put back the original
          </button>
        ) : null}
      </div>

      {history.length ? (
        <details style={{ marginTop: 10 }}>
          <summary className="tiny" style={{ cursor: 'pointer' }}>Earlier versions ({history.length})</summary>
          {history.map((h, i) => (
            <div key={i} className="tiny" style={{ padding: '6px 0', borderTop: '1px solid var(--line, #e4e5e7)' }}>
              {h.at} &middot; {h.action} by {h.by}
              {h.wording ? (
                <>
                  {' '}
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={() => { setW(h.wording as Wording); setPreview(null); setResult(null); }}
                  >
                    Load this version
                  </button>
                </>
              ) : null}
            </div>
          ))}
        </details>
      ) : null}
    </div>
  );
}
