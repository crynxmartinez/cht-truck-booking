'use client';

import { useEffect, useRef, useState } from 'react';
import {
  DAMAGE_WAIVER_NOTICE,
  RENTAL_CLAUSES,
  RENTAL_INTRO,
  WAIVER_CLAUSES,
  WAIVER_CLOSING,
  WAIVER_INTRO,
  WAIVER_TITLE,
} from '@/lib/contract-terms';

/**
 * The full legal text, scrollable. Signing stays disabled until the reader
 * reaches the bottom — cheap to build, and it is what turns "I have read and
 * agree" from a checkbox into something defensible.
 */
export function Terms({
  clientName,
  dateLabel,
  onRead,
}: {
  clientName: string;
  dateLabel: string;
  onRead: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [read, setRead] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const check = () => {
      // A short viewport on a tall phone can already be at the bottom.
      const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
      if (atEnd && !read) {
        setRead(true);
        onRead();
      }
    };
    check();
    el.addEventListener('scroll', check, { passive: true });
    return () => el.removeEventListener('scroll', check);
  }, [read, onRead]);

  return (
    <>
      <div className="terms" ref={ref} tabIndex={0} role="region" aria-label="Rental agreement terms">
        <h4>Rental Agreement</h4>
        <p>{RENTAL_INTRO}</p>
        {RENTAL_CLAUSES.map((c, i) => (
          <div key={i}>
            {c.title ? (
              <h4>
                {c.n}. {c.title}
              </h4>
            ) : null}
            {c.body.map((b, j) => (
              <p key={j} className={!c.title && b === b.toUpperCase() ? 'shout' : undefined}>
                {b}
              </p>
            ))}
            {c.sub?.map((s, j) => (
              <p key={`s${j}`} className="sub">
                {s}
              </p>
            ))}
          </div>
        ))}

        <h4 style={{ marginTop: 26 }}>{WAIVER_TITLE}</h4>
        <p>{WAIVER_INTRO.replace('{{date}}', dateLabel).replace('{{client_name}}', clientName || '____________')}</p>
        {WAIVER_CLAUSES.map((c, i) => (
          <div key={i}>
            {c.title ? (
              <h4>
                {c.n}. {c.title}
              </h4>
            ) : null}
            {c.body.map((b, j) => (
              <p key={j} className={c.title ? 'sub' : undefined}>
                {b}
              </p>
            ))}
          </div>
        ))}
        <p style={{ marginTop: 14 }}>{WAIVER_CLOSING}</p>
        <p className="tiny" style={{ marginTop: 16 }}>
          {DAMAGE_WAIVER_NOTICE}
        </p>
      </div>
      <p className={read ? 'scrollnote done' : 'scrollnote'}>
        {read ? '✓ You have read the full agreement' : 'Scroll to the end of the agreement to continue'}
      </p>
    </>
  );
}
