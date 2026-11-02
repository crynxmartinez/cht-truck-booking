import { prisma } from '@/lib/db';
import { loadSettings } from '@/lib/settings';
import { STORAGE_STATE_KEY, formatBytes, parseStorageState } from '@/lib/storage-alert';
import { Nav } from './Nav';
import './crm.css';

export const dynamic = 'force-dynamic';

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  await loadSettings();
  const [active, needsAttention, pendingSigs] = await Promise.all([
    prisma.booking.count({ where: { stage: { notIn: ['COMPLETED', 'CANCELLED'] } } }),
    prisma.booking.count({
      where: { OR: [{ overdue: true }, { needsReview: true }, { rescheduleAsked: true }] },
    }),
    prisma.contract.count({
      where: { status: 'SIGNED', counterSignedAt: null, booking: { stage: { notIn: ['CANCELLED'] } } },
    }),
  ]);

  // The daily storage reading. A page must never fail because of a banner.
  const storage = await prisma.setting
    .findUnique({ where: { key: STORAGE_STATE_KEY } })
    .then((row) => parseStorageState(row?.value))
    .catch(() => null);

  return (
    <div className="crm">
      <Nav counts={{ active, needsAttention, pendingSigs }} />
      <div className="main">
        {storage && storage.level !== 'ok' ? (
          <div className="note alert" role="alert" style={{ margin: '12px 16px 0' }}>
            <b>{storage.level === 'urgent' ? 'Storage is almost full' : 'Storage is filling up'}:</b>{' '}
            {formatBytes(storage.usedBytes)} of {formatBytes(storage.quotaBytes)} ({Math.round(storage.pct)}%).
            {storage.level === 'urgent'
              ? ' When it is full, renters cannot upload their licence photos, so they cannot book.'
              : ''}{' '}
            See <a href="/app/storage">Storage</a>.
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}
