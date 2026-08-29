import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { dateToIso, formatLong } from '@/lib/dates';
import { CardHeader, DeadLink, PageFooter } from '@/components/Brand';
import { SignForm } from '@/components/SignForm';

export const dynamic = 'force-dynamic';

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const contract = await prisma.contract.findUnique({
    where: { token },
    include: {
      booking: {
        include: {
          truck: true,
          additionalDriver: true,
        },
      },
    },
  });

  if (!contract) {
    return (
      <DeadLink
        title="This link is not valid"
        body="It may have expired or been replaced. Check for a newer message from us, or reply to your text and we will send a fresh one."
      />
    );
  }

  const b = contract.booking;

  if (b.stage === 'CANCELLED') {
    return <DeadLink title="This booking was cancelled" body="Nothing further is needed. Get in touch if that is a surprise." />;
  }
  if (contract.status === 'VOID') {
    return <DeadLink title="This agreement was replaced" body="Look for a newer link from us, or reply to your text and we will resend it." />;
  }

  // First open — record it so the CRM can show "viewed but not signed".
  if (!contract.viewedAt) {
    await prisma.contract
      .update({ where: { id: contract.id }, data: { viewedAt: new Date(), status: contract.status === 'SENT' ? 'VIEWED' : contract.status } })
      .catch(() => undefined);
  }

  const isAdditional = contract.type === 'ADDITIONAL_DRIVER';
  const pickupIso = dateToIso(b.pickupDate);
  const returnIso = dateToIso(b.returnDate);

  const prefill: Record<string, string> = isAdditional
    ? {
        name: contract.signerName ?? b.additionalDriver?.name ?? '',
        phone: b.additionalDriver?.phone ?? '',
        email: b.additionalDriver?.email ?? '',
      }
    : { phone: b.phone ?? '', email: b.email ?? '' };

  return (
    <div className="shell">
      <div className="card">
        <CardHeader subtitle={isAdditional ? 'Additional Driver Agreement' : 'Truck Rental Agreement'} />
        <SignForm
          token={token}
          type={contract.type}
          reference={b.reference}
          clientName={isAdditional ? (b.additionalDriver?.name ?? '') : `${b.firstName} ${b.lastName}`.trim()}
          dateLabel={formatLong(pickupIso)}
          pickupDateLabel={formatLong(pickupIso)}
          returnDateLabel={formatLong(returnIso)}
          truck={b.truck ? { code: b.truck.code, plate: b.truck.plate, year: b.truck.year } : null}
          pickupAddress={config.pickupAddress}
          prefill={prefill}
          mainRenterName={`${b.firstName} ${b.lastName}`.trim()}
          alreadySigned={contract.status === 'SIGNED'}
          pdfUrl={contract.pdfUrl}
        />
      </div>
      <PageFooter />
    </div>
  );
}
