'use client';

import { useState, useTransition } from 'react';
import { markFailuresHandled } from './actions';

/** One button for one failed message, or for all of them when given several ids. */
export function HandledButton({
  ids,
  label,
  confirm,
}: {
  ids: string[];
  label: string;
  /** Asked before anything changes, for the bulk button. */
  confirm?: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function click() {
    if (confirm && !window.confirm(confirm)) return;
    setError(null);
    start(async () => {
      try {
        const res = await markFailuresHandled(ids);
        if (!res.ok) setError(res.error);
      } catch {
        setError('That did not work. Try again.');
      }
    });
  }

  return (
    <>
      <button className="btn ghost small" disabled={pending} onClick={click}>
        {pending ? 'Saving…' : label}
      </button>
      {error ? (
        <div className="tiny" style={{ color: 'var(--red, #d6001c)' }}>
          {error}
        </div>
      ) : null}
    </>
  );
}
