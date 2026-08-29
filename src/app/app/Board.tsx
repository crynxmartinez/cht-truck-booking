'use client';

import { useState, useTransition } from 'react';
import type { Stage } from '@prisma/client';
import { STAGE_META } from '@/lib/stages';
import type { BookingDetail, CardData, TruckOption } from './types';
import { BookingModal } from './BookingModal';

export function Board({
  cards,
  trucks,
  loadDetail,
}: {
  cards: CardData[];
  trucks: TruckOption[];
  loadDetail: (id: string) => Promise<BookingDetail | null>;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<BookingDetail | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const q = query.trim().toLowerCase();
  const visible = q
    ? cards.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.reference.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          c.phone.includes(q),
      )
    : cards;

  function openCard(id: string) {
    setLoadingId(id);
    startTransition(async () => {
      const detail = await loadDetail(id);
      setOpen(detail);
      setLoadingId(null);
    });
  }

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
      </div>

      <div className="content">
        <div className="board">
          {STAGE_META.map((meta) => {
            const items = visible.filter((c) => c.stage === meta.stage);
            return (
              <div className="col" key={meta.stage}>
                <div className="col-hd">
                  <span className="dot" style={{ background: meta.dot }} />
                  <b>{meta.label}</b>
                  <span className="n">{items.length}</span>
                </div>
                {items.length === 0 ? (
                  <div className="col-empty">Nothing here</div>
                ) : (
                  items.map((c) => (
                    <BoardCard key={c.id} card={c} busy={loadingId === c.id} onOpen={() => openCard(c.id)} />
                  ))
                )}
              </div>
            );
          })}
        </div>
      </div>

      {open ? <BookingModal detail={open} trucks={trucks} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function BoardCard({ card, busy, onOpen }: { card: CardData; busy: boolean; onOpen: () => void }) {
  return (
    <button type="button" className="bcard" onClick={onOpen} style={busy ? { opacity: 0.6 } : undefined}>
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
        <span className="tag">{card.reference}</span>
      </div>
    </button>
  );
}

export type StageOption = { stage: Stage; label: string };
