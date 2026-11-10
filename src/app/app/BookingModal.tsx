'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import type { Stage } from '@prisma/client';
import { STAGE_LABEL } from '@/lib/stages';
import type { Ack } from '@/lib/stage-moves';
import type { ThreadItem } from '@/lib/conversation';
import type { ActionResult } from './actions';
import { cancel, getThread, markConversationRead, moveCard, reopen } from './actions';
import type { BookingDetail } from './types';
import { ActivityPanel } from './modal/ActivityPanel';
import { Conversation } from './modal/Conversation';
import { FilesPanel } from './modal/FilesPanel';
import { OverviewPanel } from './modal/OverviewPanel';
import { PaperworkPanel } from './modal/PaperworkPanel';

type TabKey = 'overview' | 'conversation' | 'paperwork' | 'files' | 'activity';

/** How often the open window looks for a new reply. Quiet: one small read, and only while the tab is showing. */
const POLL_MS = 20_000;

/**
 * One booking, opened from a card. A menu down the left picks what to look at; the
 * conversation with the renter is one of the sections, with its message box always
 * in view. The heading, the result of the last action and the Cancel / Done bar
 * stay put whichever section is showing.
 */
export function BookingModal({
  detail,
  onClose,
  onRead,
}: {
  detail: BookingDetail;
  onClose: () => void;
  /** Told when the replies in this booking have been read, so the card can drop its flag. */
  onRead?: (bookingId: string) => void;
}) {
  const c = detail.card;
  const [tab, setTab] = useState<TabKey>(detail.unread > 0 ? 'conversation' : 'overview');
  const [flash, setFlash] = useState<ActionResult | null>(null);
  // The column this booking is in now. It changes when it is moved from here, so a second move starts from the right place.
  const [stage, setStage] = useState<Stage>(c.stage);
  const [thread, setThread] = useState<{ items: ThreadItem[]; unread: number }>({ items: detail.thread, unread: detail.unread });
  const [pending, startTransition] = useTransition();

  const waitingOnApproval =
    detail.contracts.some((k) => k.status === 'SIGNED' && !k.counterSignedLabel) ||
    detail.checklists.some((k) => !k.counterSignedLabel && k.submitted);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', esc);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const refreshThread = useCallback(async () => {
    try {
      const t = await getThread(c.id);
      if (t) setThread(t);
    } catch {
      /* a missed poll is fine; the next one tries again */
    }
  }, [c.id]);

  // Look for new replies while the window is open and showing.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void refreshThread();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [refreshThread]);

  // Looking at the conversation reads it. The card's flag goes, and so does the number on the menu.
  useEffect(() => {
    if (tab !== 'conversation' || thread.unread === 0) return;
    let live = true;
    markConversationRead(c.id)
      .then((r) => {
        if (!live || !r.ok) return;
        setThread((t) => ({ ...t, unread: 0 }));
        onRead?.(c.id);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [tab, thread.unread, c.id, onRead]);

  /**
   * Move to another stage with the same rules as dragging on the Board. When the
   * move needs a yes (or an override), the reasons are shown and nothing changes
   * until the person agrees.
   */
  async function moveTo(to: Stage): Promise<ActionResult> {
    let ack: Ack = 'none';
    let from: Stage = stage;
    let followed = false;
    for (;;) {
      const r = await moveCard(c.id, from, to, ack, 'button');
      if (r.ok) {
        setStage(to);
        return { ok: true, message: r.message };
      }
      if ('error' in r) {
        // Approving, or someone else, may have moved it since this window opened. The
        // person asked for this column, so go there from where it really is, once.
        if (r.stale && r.now && !followed) {
          followed = true;
          from = r.now;
          setStage(r.now);
          continue;
        }
        return { ok: false, error: r.error };
      }
      const text =
        r.reasons.join('\n\n') +
        (r.needs === 'override' ? '\n\nMove it anyway? This is recorded on the booking.' : '\n\nMove it?');
      if (!window.confirm(text)) return { ok: false, error: 'Not moved.' };
      ack = r.needs === 'override' ? 'override' : 'confirmed';
    }
  }

  function run(fn: () => Promise<ActionResult>) {
    startTransition(async () => {
      try {
        setFlash(await fn());
      } catch {
        setFlash({ ok: false, error: 'That did not work. Try again.' });
      }
    });
  }

  const panelProps = { detail, stage, pending, run, moveTo };

  const tabs: Array<{ key: TabKey; label: string; badge?: { text: string; soft?: boolean } }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'conversation', label: 'Conversation', badge: thread.unread > 0 ? { text: String(thread.unread) } : undefined },
    { key: 'paperwork', label: 'Paperwork', badge: waitingOnApproval ? { text: '!' } : undefined },
    { key: 'files', label: 'Files', badge: detail.documents.length ? { text: String(detail.documents.length), soft: true } : undefined },
    { key: 'activity', label: 'Activity' },
  ];

  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal split" role="dialog" aria-modal="true" aria-label={`Booking ${c.reference}`}>
        <div className="modal-hd">
          <div>
            <h2>{c.name}</h2>
            <div className="sub">
              {c.reference} &middot; {STAGE_LABEL[stage]} &middot; booked {c.createdLabel}
            </div>
          </div>
          <button className="x" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        <div className="modal-body">
          <nav className="modal-nav" aria-label="Booking sections">
            {tabs.map((t) => (
              <button key={t.key} type="button" aria-current={tab === t.key ? 'page' : undefined} onClick={() => setTab(t.key)}>
                {t.label}
                {t.badge ? (
                  <span className={`dot${t.badge.soft ? ' soft' : ''}`} aria-label={t.key === 'conversation' ? `${t.badge.text} new` : undefined}>
                    {t.badge.text}
                  </span>
                ) : null}
              </button>
            ))}
          </nav>

          <div className="modal-main">
            {flash ? (
              <div className={`flash-row ${flash.ok ? 'note ok' : 'note alert'}`} role="status">
                <span>{flash.ok ? flash.message : flash.error}</span>
                <button type="button" className="x-small" onClick={() => setFlash(null)} aria-label="Dismiss">
                  &times;
                </button>
              </div>
            ) : null}

            <div className={`modal-bd${tab === 'conversation' ? ' flush' : ''}`}>
              {tab === 'overview' ? <OverviewPanel {...panelProps} /> : null}
              {tab === 'conversation' ? (
                <Conversation
                  bookingId={c.id}
                  name={c.name}
                  items={thread.items}
                  textsBlocked={detail.textsBlocked}
                  onResult={setFlash}
                  onSent={(r) => {
                    setFlash(r);
                    void refreshThread();
                  }}
                />
              ) : null}
              {tab === 'paperwork' ? <PaperworkPanel {...panelProps} /> : null}
              {tab === 'files' ? <FilesPanel {...panelProps} /> : null}
              {tab === 'activity' ? <ActivityPanel {...panelProps} /> : null}
            </div>
          </div>
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
                if (reason !== null && reason.trim()) {
                  const tell = window.confirm(
                    'Send the renter a text and an email saying their booking is cancelled?\n\nOK = send it\nCancel = do not send (you will tell them yourself)',
                  );
                  run(() => cancel(c.id, reason, tell));
                }
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
