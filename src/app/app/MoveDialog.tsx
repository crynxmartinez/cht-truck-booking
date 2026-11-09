'use client';

import { useEffect } from 'react';

/**
 * Asks before a risky move. The reasons come from the server, which has already
 * refused to move anything: nothing changes until the person says yes here.
 * Cancel is the default (it has focus), so Enter or a stray tap does not agree.
 */
export function MoveDialog({
  name,
  fromLabel,
  toLabel,
  reasons,
  needs,
  busy,
  onCancel,
  onConfirm,
}: {
  name: string;
  fromLabel: string;
  toLabel: string;
  reasons: readonly string[];
  needs: 'confirm' | 'override';
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onCancel]);

  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="move-title"
        aria-describedby="move-why"
        style={{ maxWidth: 460 }}
      >
        <div className="modal-hd">
          <div>
            <h2 id="move-title">
              Move {name} to {toLabel}?
            </h2>
            <div className="sub">
              From {fromLabel} to {toLabel}
            </div>
          </div>
        </div>
        <div style={{ padding: '14px 22px 4px' }} id="move-why">
          {reasons.map((r) => (
            <p key={r} style={{ margin: '0 0 10px' }}>
              {r}
            </p>
          ))}
          {needs === 'override' ? (
            <p className="tiny" style={{ margin: '0 0 10px' }}>
              Moving it anyway is allowed, and is recorded on the booking.
            </p>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '8px 22px 18px' }}>
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy} autoFocus>
            Cancel
          </button>
          <button type="button" className={needs === 'override' ? 'btn' : 'btn primary'} onClick={onConfirm} disabled={busy}>
            {busy ? 'Moving…' : needs === 'override' ? 'Move anyway' : 'Move it'}
          </button>
        </div>
      </div>
    </div>
  );
}

export type ToastData = { id: number; kind: 'ok' | 'err'; text: string; undo?: () => void };

/** What just happened, for a few seconds, with Undo when the move can be taken back. */
export function Toast({ toast, onDismiss }: { toast: ToastData; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 8000);
    return () => clearTimeout(t);
  }, [toast.id, onDismiss]);

  return (
    <div className={`move-toast ${toast.kind}`} role="status">
      <span>{toast.text}</span>
      {toast.undo ? (
        <button
          type="button"
          className="btn ghost small"
          onClick={() => {
            toast.undo?.();
            onDismiss();
          }}
        >
          Undo
        </button>
      ) : null}
      <button type="button" className="btn ghost small" onClick={onDismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
