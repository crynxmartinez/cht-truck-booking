import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { blobConfigured, measureUsage } from '@/lib/storage';
import { formatStamp } from '@/lib/dates';

export const dynamic = 'force-dynamic';

function mb(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export default async function StoragePage() {
  const connected = blobConfigured();

  const [byKind, pending, deleted] = await Promise.all([
    prisma.document.groupBy({
      by: ['kind'],
      where: { deletedAt: null },
      _count: { _all: true },
      _sum: { bytes: true },
    }),
    prisma.document.count({ where: { deletedAt: null, purgeEligibleAt: { not: null, lte: new Date() } } }),
    prisma.document.count({ where: { deletedAt: { not: null } } }),
  ]);

  let usage: Awaited<ReturnType<typeof measureUsage>> | null = null;
  let usageError: string | null = null;
  if (connected) {
    try {
      usage = await measureUsage();
    } catch (err) {
      usageError = err instanceof Error ? err.message : String(err);
    }
  }

  const dbBytes = byKind.reduce((n, r) => n + (r._sum.bytes ?? 0), 0);
  const pct = usage?.pct ?? (config.blob.quotaBytes ? (dbBytes / config.blob.quotaBytes) * 100 : 0);
  const level = pct >= config.blob.purgeStartPct ? 'crit' : pct >= 60 ? 'warn' : '';

  return (
    <>
      <div className="topbar">
        <h1>Storage</h1>
      </div>
      <div className="content">
        {!connected ? (
          <div className="panel">
            <h2>Blob storage is not connected yet</h2>
            <div className="hint" style={{ marginBottom: 0 }}>
              In Vercel: <b>Storage &rarr; Create &rarr; Blob &rarr; Connect to project</b>. The
              <code> BLOB_READ_WRITE_TOKEN</code> is injected automatically — you do not set it by hand.
              Until then, uploads are refused with a message telling people to call you.
            </div>
          </div>
        ) : null}

        <div className="panel">
          <h2>Usage</h2>
          <div className="hint">
            The nightly job starts deleting once usage passes {config.blob.purgeStartPct}%, and keeps going
            until it is back under {config.blob.purgeTargetPct}%.
          </div>

          <div className="gauge">
            <i className={level} style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span>
              <b>{mb(usage?.totalBytes ?? dbBytes)}</b> of {mb(config.blob.quotaBytes)}
            </span>
            <span style={{ color: level === 'crit' ? 'var(--red)' : 'var(--mut)' }}>{pct.toFixed(1)}%</span>
          </div>
          {usageError ? <div className="note alert" style={{ marginTop: 12 }}>Could not read live usage: {usageError}</div> : null}
        </div>

        <div className="panel">
          <h2>What is stored</h2>
          <div className="tablewrap">
            <table className="datatable">
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>Files</th>
                  <th>Size</th>
                  <th>Retention after a booking closes</th>
                </tr>
              </thead>
              <tbody>
                {byKind.map((r) => (
                  <tr key={r.kind}>
                    <td>{r.kind.replace(/_/g, ' ').toLowerCase()}</td>
                    <td>{r._count._all}</td>
                    <td>{mb(r._sum.bytes ?? 0)}</td>
                    <td className="tiny">
                      {r.kind === 'SIGNED_CONTRACT'
                        ? 'Never deleted — legal record'
                        : r.kind === 'DRIVER_LICENSE' || r.kind === 'INSURANCE'
                          ? `${config.retention.idDocsDays} days`
                          : `${config.retention.checklistPhotoDays} days`}
                    </td>
                  </tr>
                ))}
                {byKind.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="tiny">
                      Nothing uploaded yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <p className="tiny" style={{ marginTop: 12 }}>
            {pending} file{pending === 1 ? '' : 's'} past their retention date and eligible for the next
            purge &middot; {deleted} already purged. Files on an open, overdue or flagged booking are never
            eligible, whatever the storage level.
          </p>
        </div>

        <div className="panel">
          <h2>Adjusting the quota</h2>
          <div className="hint" style={{ marginBottom: 0 }}>
            <code>BLOB_QUOTA_BYTES</code> is currently {mb(config.blob.quotaBytes)}. Set it to whatever your
            Vercel plan actually includes, otherwise the 80% rule is measuring against the wrong number.
            Last checked {formatStamp(new Date())}.
          </div>
        </div>
      </div>
    </>
  );
}
