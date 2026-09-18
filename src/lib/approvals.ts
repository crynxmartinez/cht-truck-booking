import { Stage } from '@prisma/client';
import { prisma } from './db';
import { logEvent, mainAdmin, notify, notifyStaff, setStage } from './notify';

/**
 * Main-admin counter-signature.
 *
 * The renter signing is not the end of it — somebody at Cory Home Team signs
 * too, at three points that mirror the Dispatched / Received rows on the paper
 * form: approving the rental, releasing the truck, and receiving it back.
 *
 * The signature itself is drawn once, when a person is made main admin, and
 * stamped on each approval from the CRM. Re-drawing on a phone three times per
 * rental would simply stop happening within a week, and an approval nobody
 * performs is worse than none.
 */

export type ApprovalTarget =
  | { kind: 'contract'; id: string }
  | { kind: 'checklist'; id: string };

export class ApprovalError extends Error {}

async function signer() {
  const admin = await mainAdmin();
  if (!admin) {
    throw new ApprovalError('No main admin is set. Add one under Notifications before approving.');
  }
  if (!admin.signatureData) {
    throw new ApprovalError(
      `${admin.name} has no signature on file. Add one under Notifications before approving.`,
    );
  }
  return admin;
}

/**
 * Approve the rental agreement. This is the gate on confirmation: the renter is
 * only told the truck is theirs once a human here has signed it off.
 */
export async function approveContract(contractId: string) {
  const admin = await signer();

  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    include: { booking: { select: { id: true, stage: true, reference: true } } },
  });
  if (!contract) throw new ApprovalError('That agreement no longer exists.');
  if (contract.status !== 'SIGNED') throw new ApprovalError('The renter has not signed this yet.');
  if (contract.counterSignedAt) return { alreadySigned: true, bookingId: contract.booking.id };

  await prisma.contract.update({
    where: { id: contractId },
    data: {
      counterSignedAt: new Date(),
      counterSignedById: admin.id,
      counterSignerName: admin.name,
      counterSignatureData: admin.signatureData,
    },
  });

  await logEvent(
    contract.booking.id,
    'contract_countersigned',
    `${admin.name} approved the ${contract.type === 'RENTAL_AGREEMENT' ? 'rental agreement' : 'additional driver agreement'}`,
    admin.email,
  );

  // Confirm only when nothing is left unsigned on either side.
  const outstanding = await prisma.contract.count({
    where: {
      bookingId: contract.booking.id,
      status: { notIn: ['VOID'] },
      OR: [{ status: { in: ['SENT', 'VIEWED'] } }, { counterSignedAt: null }],
    },
  });

  if (outstanding === 0) {
    await setStage(contract.booking.id, Stage.CONFIRMED, admin.email, 'Approved by the main admin');
    await notify(contract.booking.id, 'rental_confirmed');
    await notifyStaff(contract.booking.id, 'confirmed');
  }

  return { alreadySigned: false, bookingId: contract.booking.id, confirmed: outstanding === 0 };
}

/**
 * Sign off a pickup or return checklist — the dispatch and receive halves.
 *
 * Neither blocks the renter: by the time a pickup checklist exists the truck
 * has already gone, and by the time a return one exists it is already back.
 * What the signature gates is the thank-you, which should not go out saying
 * "you're all clear" before anyone has looked at the photos.
 */
export async function approveChecklist(checklistId: string) {
  const admin = await signer();

  const checklist = await prisma.checklist.findUnique({
    where: { id: checklistId },
    include: { booking: { select: { id: true, stage: true } } },
  });
  if (!checklist) throw new ApprovalError('That checklist no longer exists.');
  if (!checklist.submittedAt) throw new ApprovalError('The renter has not submitted this yet.');
  if (checklist.counterSignedAt) return { alreadySigned: true, bookingId: checklist.booking.id };

  await prisma.checklist.update({
    where: { id: checklistId },
    data: {
      counterSignedAt: new Date(),
      counterSignedById: admin.id,
      counterSignerName: admin.name,
      counterSignatureData: admin.signatureData,
    },
  });

  const isReturn = checklist.phase === 'DROPOFF';
  await logEvent(
    checklist.booking.id,
    isReturn ? 'return_countersigned' : 'dispatch_countersigned',
    `${admin.name} signed off the ${isReturn ? 'return' : 'dispatch'} condition report`,
    admin.email,
  );

  if (isReturn) {
    await notify(checklist.booking.id, 'thank_you');
  }

  return { alreadySigned: false, bookingId: checklist.booking.id };
}

/** Everything waiting on the main admin, for the board and the alert copy. */
export async function pendingApprovals() {
  const [contracts, checklists] = await Promise.all([
    prisma.contract.findMany({
      where: { status: 'SIGNED', counterSignedAt: null, booking: { stage: { notIn: ['CANCELLED'] } } },
      include: { booking: { select: { id: true, reference: true, firstName: true, lastName: true } } },
    }),
    prisma.checklist.findMany({
      where: { submittedAt: { not: null }, counterSignedAt: null, booking: { stage: { notIn: ['CANCELLED'] } } },
      include: { booking: { select: { id: true, reference: true, firstName: true, lastName: true } } },
    }),
  ]);
  return { contracts, checklists, total: contracts.length + checklists.length };
}
