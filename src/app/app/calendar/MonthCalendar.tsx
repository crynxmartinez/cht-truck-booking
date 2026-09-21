'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { addBlackout, type ActionResult } from '../actions';
import { BookingModal } from '../BookingModal';
import { NewBooking } from '../NewBooking';
import type { BookingDetail, TruckOption } from '../types';

export type SegmentDTO = {
  id: string;
  kind: 'booking' | 'blackout';
  truck: 'A' | 'B' | null;
  label: string;
  sublabel: string | null;
  start: string;
  end: string;
  unsigned: boolean;
  col: number;
  span: number;
  lane: number;
  isStart: boolean;
  isEnd: boolean;
};

export type WeekDTO = { days: string[]; lanes: number; segments: SegmentDTO[] };

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function shape(s: SegmentDTO) {
  if (s.isStart && s.isEnd) return 'whole';
  if (s.isStart) return 'start';
  if (s.isEnd) return 'end';
  return 'mid';
}

const pretty = (iso: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' })
    .format(new Date(iso + 'T00:00:00Z'));

export function MonthCalendar({
  title, prevHref, nextHref, todayHref, filter, filterHrefs,
  monthIndex, today, weeks, trucks, defaultDays, loadDetail,
}: {
  title: string;
  prevHref: string;
  nextHref: string;
  todayHref: string;
  filter: 'A' | 'B' | null;
  filterHrefs: { all: string; a: string; b: string };
  monthIndex: number;
  today: string;
  weeks: WeekDTO[];
  trucks: TruckOption[];
  defaultDays: number;
  loadDetail: (id: string) => Promise<BookingDetail | null>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<BookingDetail | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [chooseDay, setChooseDay] = useState<string | null>(null);
  const [blockDay, setBlockDay] = useState<string | null>(null);
  const [bookDay, setBookDay] = useState<string | null>(null);
  const [flash, setFlash] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  function openBooking(id: string) {
    setBusyId(id);
    start(async () => {
      setOpen(await loadDetail(id));
      setBusyId(null);
    });
  }

  const inMonth = (iso: string) => Number(iso.slice(5, 7)) - 1 === monthIndex;
  const isWeekend = (i: number) => i === 0 || i === 6;

  function renderBar(s: SegmentDTO, agenda = false) {
    const cls = [
      'cal-ev',
      s.kind === 'blackout' ? 'blk' : s.truck === 'B' ? 'b' : 'a',
      agenda ? 'whole' : shape(s),
      s.unsigned ? 'unsigned' : '',
    ].filter(Boolean).join(' ');

    const title =
      s.kind === 'blackout'
        ? `Truck ${s.truck} blocked — ${s.sublabel ?? ''}`
        : `${s.label} · Truck ${s.truck ?? '?'} · ${pretty(s.start)} to ${pretty(s.end)}${s.unsigned ? ' · awaiting your signature' : ''}`;

    const text =
      s.kind === 'blackout'
        ? (s.isStart || agenda ? `${s.label}${s.sublabel ? ` — ${s.sublabel}` : ''}` : '')
        : (s.isStart || agenda ? `${s.truck ?? '?'} · ${s.label}` : '');

    if (s.kind === 'blackout') {
      return (
        <div
          key={s.id + s.col}
          className={cls}
          title={title}
          style={agenda ? undefined : { gridColumn: `${s.col} / span ${s.span}`, ['--lane' as string]: s.lane }}
        >
          {text}
        </div>
      );
    }

    return (
      <button
        key={s.id + s.col}
        className={cls}
        title={title}
        onClick={() => openBooking(s.id)}
        disabled={pending && busyId === s.id}
        style={agenda ? undefined : { gridColumn: `${s.col} / span ${s.span}`, ['--lane' as string]: s.lane }}
      >
        {text}
      </button>
    );
  }

  return (
    <>
      {flash ? <div className={flash.ok ? 'note ok' : 'note alert'}>{flash.ok ? flash.message : flash.error}</div> : null}

      <div className="cal-bar">
        <h2>{title}</h2>
        <div className="cal-nav">
          <Link href={prevHref} aria-label="Previous month">&#8249;</Link>
          <Link href={todayHref}>Today</Link>
          <Link href={nextHref} aria-label="Next month">&#8250;</Link>
        </div>
        <div className="spacer" />
        <div className="cal-filter">
          <Link href={filterHrefs.all} className={!filter ? 'on' : undefined}>Both</Link>
          <Link href={filterHrefs.a} className={filter === 'A' ? 'on' : undefined}>Truck A</Link>
          <Link href={filterHrefs.b} className={filter === 'B' ? 'on' : undefined}>Truck B</Link>
        </div>
      </div>

      <div className="cal-dow">
        {DOW.map((d, i) => (
          <div key={d} className={isWeekend(i) ? 'we' : undefined}>{d.slice(0, 3)}</div>
        ))}
      </div>

      <div className="cal">
        {weeks.map((w, wi) => (
          <div
            key={wi}
            className="cal-week"
            style={{ minHeight: Math.max(132, 44 + w.lanes * 24) }}
          >
            {w.days.map((d, di) => {
              const busy = { a: false, b: false };
              for (const s of w.segments) {
                if (d < s.start || d > s.end) continue;
                if (s.truck === 'A') busy.a = true;
                if (s.truck === 'B') busy.b = true;
              }
              const cls = [
                'cal-day',
                isWeekend(di) ? 'we' : '',
                inMonth(d) ? '' : 'out',
                d === today ? 'today' : d < today ? 'past' : '',
              ].filter(Boolean).join(' ');

              return (
                <div key={d} className={cls} style={{ position: 'relative' }}>
                  <div className="cal-num">{Number(d.slice(8))}</div>
                  <div className="cal-dots">
                    <i className={busy.a ? 'busy-a' : undefined} title={`Truck A ${busy.a ? 'booked' : 'free'}`} />
                    <i className={busy.b ? 'busy-b' : undefined} title={`Truck B ${busy.b ? 'booked' : 'free'}`} />
                    {!busy.a && !busy.b ? <small>both free</small> : null}
                  </div>
                  {!busy.a || !busy.b ? (
                    <button
                      className="cal-add"
                      title={`Book or block ${pretty(d)}`}
                      aria-label={`Book or block ${pretty(d)}`}
                      onClick={() => setChooseDay(d)}
                    />
                  ) : null}
                </div>
              );
            })}

            <div className="cal-lanes" style={{ gridTemplateRows: `repeat(${Math.max(1, w.lanes)}, 21px)` }}>
              {w.segments.map((s) => renderBar(s))}
            </div>
          </div>
        ))}
      </div>

      {/* phones get an agenda; a 7-column grid is unreadable at that width */}
      <div className="cal-agenda">
        {weeks.flatMap((w) =>
          w.days.filter((d) => inMonth(d)).map((d) => {
            const segs = w.segments.filter((s) => d >= s.start && d <= s.end);
            if (!segs.length) return null;
            return (
              <div className="agenda-day" key={d}>
                <h4>{pretty(d)}</h4>
                {segs.map((s) => renderBar(s, true))}
              </div>
            );
          }),
        )}
      </div>

      <div className="cal-legend">
        <span><i style={{ background: '#1f4fa3' }} />Truck A</span>
        <span><i style={{ background: '#995a06' }} />Truck B</span>
        <span><i style={{ background: 'repeating-linear-gradient(45deg,#6b6e73 0 4px,#7d8085 4px 8px)' }} />Blocked</span>
        <span><i style={{ background: '#1f4fa3', boxShadow: 'inset 0 0 0 2px rgba(255,255,255,.65)' }} />Awaiting your signature</span>
        <span className="tiny">Dots show each truck &middot; click a free day to book or block it</span>
      </div>

      {chooseDay ? (
        <DayChoice
          day={chooseDay}
          onClose={() => setChooseDay(null)}
          onBook={() => {
            setBookDay(chooseDay);
            setChooseDay(null);
          }}
          onBlock={() => {
            setBlockDay(chooseDay);
            setChooseDay(null);
          }}
        />
      ) : null}

      {bookDay ? (
        <NewBooking
          trucks={trucks}
          defaultDate={bookDay}
          defaultDays={defaultDays}
          onClose={(created) => {
            setBookDay(null);
            if (created) router.refresh();
          }}
        />
      ) : null}

      {blockDay ? (
        <BlockDay
          day={blockDay}
          trucks={trucks}
          pending={pending}
          onClose={() => setBlockDay(null)}
          onSubmit={(truckId, days, reason) =>
            start(async () => {
              const end = new Date(blockDay + 'T00:00:00Z');
              end.setUTCDate(end.getUTCDate() + Math.max(1, days) - 1);
              const r = await addBlackout(truckId, blockDay, end.toISOString().slice(0, 10), reason);
              setFlash(r);
              if (r.ok) setBlockDay(null);
            })
          }
        />
      ) : null}

      {open ? <BookingModal detail={open} trucks={trucks} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function BlockDay({
  day, trucks, pending, onClose, onSubmit,
}: {
  day: string;
  trucks: TruckOption[];
  pending: boolean;
  onClose: () => void;
  onSubmit: (truckId: string, days: number, reason: string) => void;
}) {
  const [truckId, setTruckId] = useState(trucks[0]?.id ?? '');
  const [days, setDays] = useState(1);
  const [reason, setReason] = useState('');

  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 440 }}>
        <div className="modal-hd">
          <div>
            <h2>Block {pretty(day)}</h2>
            <div className="sub">Takes the truck off the booking calendar.</div>
          </div>
          <button className="x" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className="modal-bd">
          <div className="row two">
            <div>
              <label htmlFor="bt">Truck</label>
              <select id="bt" value={truckId} onChange={(e) => setTruckId(e.target.value)}>
                {trucks.map((t) => <option key={t.id} value={t.id}>Truck {t.code}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="bd">How many days</label>
              <input id="bd" type="number" min={1} max={60} value={days} onChange={(e) => setDays(Number(e.target.value))} />
            </div>
          </div>
          <div className="row" style={{ marginBottom: 0 }}>
            <label htmlFor="br">Reason</label>
            <input id="br" type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Service, repair, personal use…" />
          </div>
        </div>
        <div className="modal-ft">
          <div className="spacer" />
          <button className="btn ghost" onClick={onClose} disabled={pending}>Cancel</button>
          <button
            className="btn primary"
            disabled={pending || !truckId || !reason.trim()}
            onClick={() => onSubmit(truckId, days, reason)}
          >
            {pending ? 'Blocking…' : 'Block it'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DayChoice({
  day, onClose, onBook, onBlock,
}: {
  day: string;
  onClose: () => void;
  onBook: () => void;
  onBlock: () => void;
}) {
  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 380 }}>
        <div className="modal-hd">
          <div>
            <h2>{pretty(day)}</h2>
            <div className="sub">What are you doing with this day?</div>
          </div>
          <button className="x" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className="modal-bd">
          <button className="btn primary" style={{ width: '100%', marginBottom: 10 }} onClick={onBook}>
            Book a rental
          </button>
          <button className="btn ghost" style={{ width: '100%' }} onClick={onBlock}>
            Block the truck
          </button>
          <p className="tiny" style={{ marginTop: 12, marginBottom: 0 }}>
            Blocking takes a truck off the booking calendar for service, repair or personal use.
          </p>
        </div>
      </div>
    </div>
  );
}
