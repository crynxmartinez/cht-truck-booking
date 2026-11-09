'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import type { Stage } from '@prisma/client';
import { STAGE_META, STAGE_LABEL } from '@/lib/stages';
import type { Ack } from '@/lib/stage-moves';
import type { BookingDetail, CardData, TruckOption } from './types';
import { BookingModal } from './BookingModal';
import { NewBooking } from './NewBooking';
import { moveCard, type MoveResult } from './actions';
import { MoveDialog, Toast, type ToastData } from './MoveDialog';

/** Below this width the Board is a plain list (see crm.css), so dragging is off and the Move to stage buttons are used. */
const WIDE = '(min-width: 861px)';
const subscribeWide = (cb: () => void) => {
  const m = window.matchMedia(WIDE);
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
};
const isWide = () => window.matchMedia(WIDE).matches;

/** A click right after a drag is the drag ending, not someone opening the card. */
const CLICK_GUARD_MS = 300;

/** How long a just-moved card is shown in its new column while waiting for fresh data. */
const PRETEND_MS = 5000;

type PendingMove = { card: CardData; to: Stage; reasons: readonly string[]; needs: 'confirm' | 'override' };

/** Picks the column under the pointer; with the keyboard (no pointer) falls back to overlap. */
const collide: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length ? hits : rectIntersection(args);
};

/** Left and right arrows jump to the next column, instead of nudging 25px at a time. */
const columnKeyboard: KeyboardCoordinateGetter = (event, { context, currentCoordinates }) => {
  if (event.code !== 'ArrowRight' && event.code !== 'ArrowLeft') return undefined;
  event.preventDefault();
  const { collisionRect, droppableRects, droppableContainers } = context;
  if (!collisionRect) return undefined;

  const here = collisionRect.left + collisionRect.width / 2;
  const goingRight = event.code === 'ArrowRight';
  let best: number | null = null;
  for (const c of droppableContainers.getEnabled()) {
    const rect = droppableRects.get(c.id);
    if (!rect) continue;
    const mid = rect.left + rect.width / 2;
    if (goingRight ? mid <= here + 4 : mid >= here - 4) continue;
    if (best === null || Math.abs(mid - here) < Math.abs(best - here)) best = mid;
  }
  return best === null ? undefined : { x: currentCoordinates.x + (best - here), y: currentCoordinates.y };
};

export function Board({
  cards,
  trucks,
  defaultDays,
  dragEnabled,
  loadDetail,
}: {
  cards: CardData[];
  trucks: TruckOption[];
  defaultDays: number;
  dragEnabled: boolean;
  loadDetail: (id: string) => Promise<BookingDetail | null>;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<BookingDetail | null>(null);
  const [adding, setAdding] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Cards the server has just moved, shown in their new column until fresh data arrives.
  const [moved, setMoved] = useState<Record<string, Stage>>({});
  // Cards waiting on the server's answer. They stay put, dimmed, so a move that turns
  // out to need a yes never shows the card in the wrong column first.
  const [inflight, setInflight] = useState<Record<string, true>>({});
  const [dragging, setDragging] = useState<CardData | null>(null);
  const [dialog, setDialog] = useState<PendingMove | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);
  const toastId = useRef(0);
  const justDragged = useRef(false);

  const wide = useSyncExternalStore(subscribeWide, isWide, () => false);
  const canDrag = dragEnabled && wide;

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    // Press and hold, so scrolling the Board with a finger still works.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    // Space picks a card up, so Enter still opens it.
    useSensor(KeyboardSensor, {
      coordinateGetter: columnKeyboard,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
    }),
  );

  // Fresh data from the server replaces a pretend position once it agrees with it.
  useEffect(() => {
    setMoved((m) => {
      const next = { ...m };
      for (const id of Object.keys(next)) {
        const real = cards.find((c) => c.id === id);
        if (!real || real.stage === next[id]) delete next[id];
      }
      return Object.keys(next).length === Object.keys(m).length ? m : next;
    });
  }, [cards]);

  const showToast = useCallback((kind: ToastData['kind'], text: string, undo?: () => void) => {
    toastId.current += 1;
    setToast({ id: toastId.current, kind, text, undo });
  }, []);
  const dismissToast = useCallback(() => setToast(null), []);

  const q = query.trim().toLowerCase();
  const shown = cards.map((c) => (moved[c.id] ? { ...c, stage: moved[c.id] } : c));
  const visible = q
    ? shown.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.reference.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          c.phone.includes(q),
      )
    : shown;

  function openCard(id: string) {
    if (justDragged.current) return;
    setLoadingId(id);
    startTransition(async () => {
      const detail = await loadDetail(id);
      setOpen(detail);
      setLoadingId(null);
    });
  }

  /**
   * Ask the server to move a card. `card.stage` is the column the server last
   * showed. The server decides: it may move it, ask for a yes first, or say it
   * has already been moved by someone else.
   */
  const attempt = useCallback(
    async (card: CardData, to: Stage, ack: Ack, via: 'drag' | 'undo' = 'drag') => {
      setInflight((m) => ({ ...m, [card.id]: true }));
      let result: MoveResult;
      try {
        result = await moveCard(card.id, card.stage, to, ack, via);
      } catch {
        result = { ok: false, error: 'That did not work. Try again.' };
      }
      setInflight((m) => {
        const rest = { ...m };
        delete rest[card.id];
        return rest;
      });

      if (result.ok) {
        setMoved((m) => ({ ...m, [card.id]: to }));
        // If fresh data never agrees (someone else changed it again), do not keep pretending.
        setTimeout(
          () =>
            setMoved((m) => {
              if (m[card.id] !== to) return m;
              const rest = { ...m };
              delete rest[card.id];
              return rest;
            }),
          PRETEND_MS,
        );
        startTransition(() => router.refresh());
        const touchesCompleted = card.stage === 'COMPLETED' || to === 'COMPLETED';
        if (via === 'undo') {
          showToast('ok', `Moved ${card.name} back.`);
        } else {
          // Undo goes through the same rules, with the same agreement the move had.
          const undoAck: Ack = ack === 'override' ? 'override' : 'confirmed';
          showToast(
            'ok',
            `${card.name} moved to ${STAGE_LABEL[to]}.`,
            touchesCompleted ? undefined : () => void attempt({ ...card, stage: to }, card.stage, undoAck, 'undo'),
          );
        }
        return;
      }

      if ('needs' in result) {
        if (via === 'undo') {
          showToast('err', 'That cannot be undone from here. Open the booking to move it.');
        } else {
          setDialog({ card, to, reasons: result.reasons, needs: result.needs });
        }
        return;
      }
      if (result.stale) startTransition(() => router.refresh());
      showToast('err', result.error);
    },
    [router, showToast],
  );

  function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    setTimeout(() => (justDragged.current = false), CLICK_GUARD_MS);
    const card = cards.find((c) => c.id === e.active.id);
    const to = e.over?.id as Stage | undefined;
    if (!card || !to || moved[card.id] || inflight[card.id] || to === card.stage) return;
    void attempt(card, to, 'none');
  }

  async function confirmDialog() {
    if (!dialog) return;
    setDialogBusy(true);
    const { card, to, needs } = dialog;
    setDialog(null);
    await attempt(card, to, needs === 'override' ? 'override' : 'confirmed');
    setDialogBusy(false);
  }

  const columns = (
    <div className={`board${canDrag ? ' droppable' : ''}${dragging ? ' dragging' : ''}`}>
      {STAGE_META.map((meta) => {
        const items = visible.filter((c) => c.stage === meta.stage);
        return (
          <Column key={meta.stage} stage={meta.stage} enabled={canDrag}>
            <div className="col-hd">
              <span className="dot" style={{ background: meta.dot }} />
              <b>{meta.label}</b>
              <span className="n">{items.length}</span>
            </div>
            {items.length === 0 ? (
              <div className="col-empty">Nothing here</div>
            ) : (
              items.map((c) => (
                <DraggableCard
                  key={c.id}
                  card={c}
                  canDrag={canDrag && !moved[c.id] && !inflight[c.id]}
                  busy={loadingId === c.id || Boolean(inflight[c.id])}
                  defaultDays={defaultDays}
                  onOpen={() => openCard(c.id)}
                />
              ))
            )}
          </Column>
        );
      })}
    </div>
  );

  return (
    <>
      <div className="topbar">
        <h1>Board</h1>
        <div className="spacer" />
        <input
          type="search"
          placeholder="Search name, ref, phone…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search bookings"
        />
        <button className="btn primary small" onClick={() => setAdding(true)}>
          New booking
        </button>
      </div>

      <div className="content">
        {canDrag ? (
          <DndContext
            sensors={sensors}
            collisionDetection={collide}
            onDragStart={(e) => {
              justDragged.current = true;
              setDragging(cards.find((c) => c.id === e.active.id) ?? null);
            }}
            onDragEnd={onDragEnd}
            onDragCancel={() => {
              setDragging(null);
              setTimeout(() => (justDragged.current = false), CLICK_GUARD_MS);
            }}
            accessibility={{
              screenReaderInstructions: {
                draggable:
                  'To move this booking, press space to pick it up, then the left or right arrow to choose a column, then space to drop it. Press escape to cancel. Press enter to open it instead.',
              },
              announcements: {
                onDragStart: ({ active }) => `Picked up ${cards.find((c) => c.id === active.id)?.name ?? 'booking'}.`,
                onDragOver: ({ over }) => (over ? `Over ${STAGE_LABEL[over.id as Stage]}.` : 'Not over a column.'),
                onDragEnd: ({ over }) => (over ? `Dropped on ${STAGE_LABEL[over.id as Stage]}.` : 'Dropped. Nothing changed.'),
                onDragCancel: () => 'Cancelled. Nothing changed.',
              },
            }}
          >
            {columns}
            <DragOverlay dropAnimation={null}>
              {dragging ? <CardBody card={dragging} defaultDays={defaultDays} className="bcard overlay" /> : null}
            </DragOverlay>
          </DndContext>
        ) : (
          columns
        )}
      </div>

      {adding ? (
        <NewBooking
          trucks={trucks}
          defaultDays={defaultDays}
          onClose={(created) => {
            setAdding(false);
            if (created) router.refresh();
          }}
        />
      ) : null}

      {open ? <BookingModal detail={open} onClose={() => setOpen(null)} /> : null}

      {dialog ? (
        <MoveDialog
          name={dialog.card.name}
          fromLabel={STAGE_LABEL[dialog.card.stage]}
          toLabel={STAGE_LABEL[dialog.to]}
          reasons={dialog.reasons}
          needs={dialog.needs}
          busy={dialogBusy}
          onCancel={() => setDialog(null)}
          onConfirm={confirmDialog}
        />
      ) : null}

      {toast ? <Toast toast={toast} onDismiss={dismissToast} /> : null}
    </>
  );
}

function Column({ stage, enabled, children }: { stage: Stage; enabled: boolean; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage, disabled: !enabled });
  return (
    <div className={`col${isOver ? ' over' : ''}`} ref={setNodeRef}>
      {children}
    </div>
  );
}

function DraggableCard({
  card,
  canDrag,
  busy,
  defaultDays,
  onOpen,
}: {
  card: CardData;
  canDrag: boolean;
  busy: boolean;
  defaultDays: number;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.id, disabled: !canDrag });
  return (
    <CardBody
      card={card}
      defaultDays={defaultDays}
      className={`bcard${canDrag ? ' grab' : ''}${isDragging ? ' lifted' : ''}`}
      innerRef={setNodeRef}
      onOpen={onOpen}
      busy={busy}
      dragProps={canDrag ? { ...attributes, ...listeners } : undefined}
    />
  );
}

function CardBody({
  card,
  defaultDays,
  className,
  innerRef,
  onOpen,
  busy,
  dragProps,
}: {
  card: CardData;
  defaultDays: number;
  className: string;
  innerRef?: (el: HTMLElement | null) => void;
  onOpen?: () => void;
  busy?: boolean;
  dragProps?: Record<string, unknown>;
}) {
  return (
    <button
      type="button"
      className={className}
      ref={innerRef}
      onClick={onOpen}
      style={busy ? { opacity: 0.6 } : undefined}
      {...dragProps}
    >
      <div className="who">{card.name}</div>
      <div className="when">
        {card.pickupLabel} <span style={{ color: 'var(--faint)' }}>&rarr;</span> {card.returnLabel}
      </div>
      <div className="tags">
        {card.truckCode ? (
          <span className={`tag truck-${card.truckCode.toLowerCase()}`}>Truck {card.truckCode}</span>
        ) : (
          <span className="tag red">No truck</span>
        )}
        {card.overdue ? <span className="tag red">Overdue</span> : null}
        {card.rescheduleAsked ? <span className="tag amber">Reschedule</span> : null}
        {card.needsReview ? <span className="tag blue">Review</span> : null}
        {card.additionalDriver ? <span className="tag">+1 driver</span> : null}
        {/* Only when it is not the usual length, so the common case stays quiet. */}
        {card.days !== defaultDays ? <span className="tag blue">{card.days === 1 ? '1 day' : `${card.days} days`}</span> : null}
        <span className="tag">{card.reference}</span>
      </div>
    </button>
  );
}

export type StageOption = { stage: Stage; label: string };
