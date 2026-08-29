import Link from 'next/link';
import { prisma } from '@/lib/db';
import './crm.css';

export const dynamic = 'force-dynamic';

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const [active, needsAttention] = await Promise.all([
    prisma.booking.count({ where: { stage: { notIn: ['COMPLETED', 'CANCELLED'] } } }),
    prisma.booking.count({
      where: { OR: [{ overdue: true }, { needsReview: true }, { rescheduleAsked: true }] },
    }),
  ]);

  return (
    <div className="crm">
      <nav className="nav">
        <div className="nav-brand">
          <div className="logo">
            C<span style={{ color: 'var(--red)' }}>&#8962;</span>RY HOME TEAM
          </div>
          <div className="sub">Truck Operations</div>
        </div>

        <div className="nav-group">Operations</div>
        <Link href="/app">
          Board <span className="count">{active}</span>
        </Link>
        <Link href="/app/attention">
          Needs attention {needsAttention ? <span className="count">{needsAttention}</span> : null}
        </Link>
        <Link href="/app/calendar">Calendar</Link>

        <div className="nav-group">Fleet</div>
        <Link href="/app/trucks">Trucks &amp; lockboxes</Link>
        <Link href="/app/blackouts">Blackout dates</Link>

        <div className="nav-group">System</div>
        <Link href="/app/storage">Storage</Link>
        <Link href="/app/settings">Settings</Link>

        <div className="nav-foot">Cory Home Team</div>
      </nav>

      <div className="main">{children}</div>
    </div>
  );
}
