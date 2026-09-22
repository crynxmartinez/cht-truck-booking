import { prisma } from '@/lib/db';
import { Nav } from './Nav';
import './crm.css';

export const dynamic = 'force-dynamic';

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const [active, needsAttention, pendingSigs] = await Promise.all([
    prisma.booking.count({ where: { stage: { notIn: ['COMPLETED', 'CANCELLED'] } } }),
    prisma.booking.count({
      where: { OR: [{ overdue: true }, { needsReview: true }, { rescheduleAsked: true }] },
    }),
    prisma.contract.count({
      where: { status: 'SIGNED', counterSignedAt: null, booking: { stage: { notIn: ['CANCELLED'] } } },
    }),
  ]);

  return (
    <div className="crm">
      <Nav counts={{ active, needsAttention, pendingSigs }} />
      <div className="main">{children}</div>
    </div>
  );
}
