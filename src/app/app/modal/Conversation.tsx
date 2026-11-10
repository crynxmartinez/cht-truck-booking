'use client';

import { Fragment, useEffect, useLayoutEffect, useRef, useState, useTransition } from 'react';
import type { ThreadItem } from '@/lib/conversation';
import { previewOfficeMessage, sendOfficeMessage, type ActionResult, type OfficePreviewResult } from '../actions';
import { TextsBlocked } from '../TextsBlocked';

const TZ = 'America/Los_Angeles';
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: TZ });
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });

/** Long messages (the agreement email, say) start folded so the thread stays readable. */
const FOLD_CHARS = 320;
const FOLD_LINES = 6;
const isLong = (t: string) => t.length > FOLD_CHARS || t.split('\n').length > FOLD_LINES;

/**
 * The renter's conversation: everything we sent and everything they replied, as a
 * chat, with the message box pinned underneath. Sending keeps its two steps: the
 * button reviews what will go and to whom, and only "Send now" sends it.
 */
export function Conversation({
  bookingId,
  name,
  items,
  textsBlocked,
  onSent,
  onResult,
}: {
  bookingId: string;
  name: string;
  items: ThreadItem[];
  textsBlocked: 'dnd' | 'unsubscribed' | null;
  /** Called after a message goes out, so the window can reload the thread. */
  onSent: (r: ActionResult) => void;
  onResult: (r: ActionResult) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  // Newest at the bottom. Follow new messages unless the reader has scrolled up to look at older ones.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const first = lastCount.current === 0;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    if (first || (items.length > lastCount.current && nearBottom)) el.scrollTop = el.scrollHeight;
    lastCount.current = items.length;
  }, [items.length]);

  // The renter's last reply decides how the next message goes: by email if they wrote by email, else by text.
  const lastReply = [...items].reverse().find((i) => i.dir === 'in');
  const preferEmail = lastReply?.channel === 'EMAIL';

  let lastDay = '';
  return (
    <div className="convo">
      <div className="thread" ref={scroller} role="log" aria-label={`Conversation with ${name}`} tabIndex={0}>
        {items.length === 0 ? (
          <p className="tiny" style={{ margin: 'auto', textAlign: 'center', maxWidth: 320 }}>
            No messages yet. What we send {name} and what they reply will show here.
          </p>
        ) : null}
        {items.map((m) => {
          const day = dayLabel(m.at);
          const showDay = day !== lastDay;
          lastDay = day;
          const long = isLong(m.text);
          const folded = long && !open[m.id];
          return (
            <Fragment key={m.id}>
              {showDay ? <div className="day-sep">{day}</div> : null}
              <div className={`bubble ${m.dir}${m.from === 'office' ? ' office' : ''}${m.failed ? ' failed' : ''}`}>
                <span className="meta">
                  {m.dir === 'in' ? 'Reply' : m.label} &middot; {m.channel === 'EMAIL' ? 'email' : 'text'} &middot; {timeLabel(m.at)}
                  {m.dir === 'out' && m.from === 'auto' ? ' · automatic' : ''}
                </span>
                {m.subject ? <b className="subj">{m.subject}</b> : null}
                <div className={folded ? 'body clamp' : 'body'}>{m.text}</div>
                {long ? (
                  <button type="button" className="linkish" onClick={() => setOpen((o) => ({ ...o, [m.id]: !o[m.id] }))}>
                    {folded ? 'Show all' : 'Show less'}
                  </button>
                ) : null}
                {m.failed ? <span className="fail">Did not go out{m.error ? `: ${m.error.slice(0, 160)}` : ''}</span> : null}
              </div>
            </Fragment>
          );
        })}
      </div>

      {textsBlocked ? (
        <div style={{ padding: '0 14px' }}>
          <TextsBlocked bookingId={bookingId} name={name} kind={textsBlocked} onResult={onResult} />
        </div>
      ) : null}

      <Composer bookingId={bookingId} name={name} preferEmail={preferEmail} onSent={onSent} />
    </div>
  );
}

function Composer({
  bookingId,
  name,
  preferEmail,
  onSent,
}: {
  bookingId: string;
  name: string;
  preferEmail: boolean;
  onSent: (r: ActionResult) => void;
}) {
  const [text, setText] = useState('');
  const [subject, setSubject] = useState('');
  const [sms, setSms] = useState(!preferEmail);
  const [email, setEmail] = useState(preferEmail);
  const [preview, setPreview] = useState<OfficePreviewResult | null>(null);
  const [pending, start] = useTransition();
  const box = useRef<HTMLTextAreaElement>(null);

  // A reply by email while the window is open switches the default; it never overrides what was already chosen by hand.
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current) {
      setSms(!preferEmail);
      setEmail(preferEmail);
    }
  }, [preferEmail]);

  const input = { text, subject, sms, email };

  // Any change after a review means it is no longer what was shown.
  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    touched.current = true;
    set(v);
    setPreview(null);
  };

  function review() {
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
        onSent(result);
        if (result.ok) {
          setText('');
          setSubject('');
          setPreview(null);
          box.current?.focus();
        }
      } catch {
        onSent({ ok: false, error: 'That did not work. Try again.' });
      }
    });
  }

  const reviewing = preview !== null && preview.ok;

  return (
    <div className="composer">
      {preview && !preview.ok ? (
        <div className="note alert" style={{ marginBottom: 8 }}>
          {preview.errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </div>
      ) : null}

      {reviewing ? (
        <div className="note" style={{ marginBottom: 8 }}>
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
          <div style={{ whiteSpace: 'pre-wrap', margin: '8px 0 4px', padding: '8px 10px', background: '#fff', borderRadius: 6 }}>
            {preview.preview.text}
          </div>
          {preview.preview.warnings.map((w) => (
            <div key={w} className="tiny" style={{ color: 'var(--warn, #8f5e0a)' }}>
              {w}
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="chips" role="group" aria-label="Send by">
            <button type="button" className={`chip${sms ? ' on' : ''}`} aria-pressed={sms} onClick={() => edit(setSms)(!sms)}>
              Text
            </button>
            <button type="button" className={`chip${email ? ' on' : ''}`} aria-pressed={email} onClick={() => edit(setEmail)(!email)}>
              Email
            </button>
            {sms ? (
              <span className="tiny" style={{ marginLeft: 'auto' }}>
                {text.trim().length} characters{text.trim().length > 160 ? ' · sent as more than one text' : ''}
              </span>
            ) : null}
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
            ref={box}
            value={text}
            onChange={(e) => edit(setText)(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && text.trim() && !pending) {
                e.preventDefault();
                review();
              }
            }}
            placeholder={`Message ${name}…  (sign it yourself: it goes exactly as you type it)`}
            aria-label="Message"
            rows={3}
          />
        </>
      )}

      <div className="composer-bar">
        <span className="tiny">You see it first and confirm before it goes.</span>
        <span style={{ flex: 1 }} />
        {reviewing ? (
          <>
            <button type="button" className="btn ghost small" disabled={pending} onClick={() => setPreview(null)}>
              Edit
            </button>
            <button type="button" className="btn primary" disabled={pending} onClick={send}>
              {pending ? 'Sending…' : 'Send now'}
            </button>
          </>
        ) : (
          <button type="button" className="btn primary" disabled={pending || !text.trim()} onClick={review}>
            {pending ? 'Checking…' : 'Send'}
          </button>
        )}
      </div>
    </div>
  );
}
