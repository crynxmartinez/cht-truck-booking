import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { CardHeader, DeadLink, PageFooter } from '@/components/Brand';
import { ChecklistFlow } from '@/components/ChecklistFlow';
import { buildSteps } from '@/lib/checklist-steps';

export const dynamic = 'force-dynamic';

export default async function ChecklistPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const checklist = await prisma.checklist.findUnique({
    where: { token },
    include: { booking: { include: { truck: true } } },
  });

  if (!checklist) {
    return (
      <DeadLink
        title="This link is not valid"
        body="It may have expired or been replaced. Check for a newer message from us, or reply to your text and we will send a fresh one."
      />
    );
  }

  const b = checklist.booking;

  if (b.stage === 'CANCELLED') {
    return <DeadLink title="This booking was cancelled" body="Nothing further is needed. Get in touch if that is a surprise." />;
  }

  if (!checklist.openedAt) {
    await prisma.checklist.update({ where: { id: checklist.id }, data: { openedAt: new Date() } }).catch(() => undefined);
  }

  const steps = buildSteps(checklist.phase);
  const isReturn = checklist.phase === 'DROPOFF';

  return (
    <div className="shell">
      <div className="card">
        <CardHeader
          subtitle={isReturn ? 'Truck Return Checklist' : 'Truck Pickup Checklist'}
        />
        <ChecklistFlow
          token={token}
          phase={checklist.phase}
          steps={steps}
          lockboxCode={b.truck?.lockboxCode ?? '—'}
          truckCode={b.truck?.code ?? '—'}
          pickupAddress={config.pickupAddress}
          reference={b.reference}
          prefill={{
            firstName: b.firstName,
            lastName: b.lastName,
            email: b.email,
            phone: b.phone,
          }}
          savedDraft={(checklist.draft as Record<string, unknown> | null) ?? null}
          alreadySubmitted={Boolean(checklist.submittedAt)}
        />
      </div>
      <PageFooter />
    </div>
  );
}
