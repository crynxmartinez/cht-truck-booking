'use client';

import { useEffect, useState, useTransition } from 'react';
import { saveSettingsAction, type SettingsResult } from './actions';

export type SettingRow = {
  key: string;
  group: string;
  label: string;
  help: string;
  kind: 'int' | 'bool';
  unit: string | null;
  min: number | null;
  max: number | null;
  value: string;
  defaultValue: string;
  defaultLabel: string;
  /** Hour settings are a list of times; the others are a number or a switch. */
  hours: Array<{ value: string; label: string }> | null;
  changed: boolean;
};

const UNIT_SUFFIX: Record<string, string> = {
  hours: 'hours',
  days: 'days',
  months: 'months',
  percent: '%',
  gb: 'GB',
};

export function SettingsEditor({ rows }: { rows: SettingRow[] }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.key, r.value])),
  );
  const [result, setResult] = useState<SettingsResult | null>(null);
  const [pending, start] = useTransition();

  // After a save or a put-back the page is re-rendered with what is now stored.
  // The form must follow it, or it keeps showing the old value and offers to
  // save that value again as if it were a fresh change.
  const stored = JSON.stringify(rows.map((r) => [r.key, r.value]));
  useEffect(() => {
    setValues(Object.fromEntries(rows.map((r) => [r.key, r.value])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored]);

  const dirty = rows.filter((r) => values[r.key] !== r.value);
  const groups = Array.from(new Set(rows.map((r) => r.group)));

  function save() {
    const input: Record<string, string> = {};
    for (const r of dirty) input[r.key] = values[r.key];
    start(async () => setResult(await saveSettingsAction(input)));
  }

  function reset(key: string) {
    start(async () => setResult(await saveSettingsAction({ [key]: null })));
  }

  return (
    <>
      {groups.map((group) => (
        <div className="panel" key={group}>
          <h2>{group}</h2>
          {rows
            .filter((r) => r.group === group)
            .map((r) => (
              <div
                key={r.key}
                style={{
                  display: 'flex',
                  gap: 16,
                  flexWrap: 'wrap',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  padding: '12px 0',
                  borderTop: '1px solid var(--line, #e4e5e7)',
                }}
              >
                <div style={{ flex: '1 1 280px', minWidth: 0 }}>
                  <b>{r.label}</b>
                  <div className="tiny" style={{ marginTop: 2 }}>
                    {r.help}
                  </div>
                </div>
                <div style={{ flex: '0 0 auto', textAlign: 'right' }}>
                  <Control row={r} value={values[r.key]} onChange={(v) => setValues({ ...values, [r.key]: v })} disabled={pending} />
                  <div className="tiny" style={{ marginTop: 4 }}>
                    {r.changed ? (
                      <>
                        Changed from the usual {r.defaultLabel} &middot;{' '}
                        <button
                          type="button"
                          className="linklike"
                          style={{ background: 'none', border: 0, padding: 0, color: 'var(--red, #d6001c)', cursor: 'pointer', font: 'inherit' }}
                          disabled={pending}
                          onClick={() => reset(r.key)}
                        >
                          Put back
                        </button>
                      </>
                    ) : (
                      <>The usual setting: {r.defaultLabel}</>
                    )}
                  </div>
                </div>
              </div>
            ))}
        </div>
      ))}

      {result ? (
        <div className={result.ok ? 'note ok' : 'note alert'} role="status">
          {result.ok ? result.message : result.errors.map((e) => <div key={e}>{e}</div>)}
        </div>
      ) : null}

      <div style={{ position: 'sticky', bottom: 0, padding: '12px 0', background: 'var(--bg, #fff)' }}>
        <button className="btn" disabled={pending || dirty.length === 0} onClick={save}>
          {pending ? 'Saving…' : dirty.length ? `Save ${dirty.length} change${dirty.length === 1 ? '' : 's'}` : 'No changes yet'}
        </button>
        {dirty.length ? (
          <button
            className="btn ghost"
            style={{ marginLeft: 8 }}
            disabled={pending}
            onClick={() => {
              setValues(Object.fromEntries(rows.map((r) => [r.key, r.value])));
              setResult(null);
            }}
          >
            Cancel
          </button>
        ) : null}
      </div>
    </>
  );
}

function Control({
  row,
  value,
  onChange,
  disabled,
}: {
  row: SettingRow;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const id = `set-${row.key}`;

  if (row.kind === 'bool') {
    return (
      <select id={id} aria-label={row.label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="true">On</option>
        <option value="false">Off</option>
      </select>
    );
  }

  if (row.hours) {
    return (
      <select id={id} aria-label={row.label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {row.hours.map((h) => (
          <option key={h.value} value={h.value}>
            {h.label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <span>
      <input
        id={id}
        aria-label={row.label}
        type="number"
        inputMode="numeric"
        min={row.min ?? undefined}
        max={row.max ?? undefined}
        step={1}
        value={value}
        disabled={disabled}
        style={{ width: 90 }}
        onChange={(e) => onChange(e.target.value)}
      />{' '}
      <span className="tiny">{row.unit ? UNIT_SUFFIX[row.unit] ?? '' : ''}</span>
    </span>
  );
}
