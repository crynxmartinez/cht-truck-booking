import {
  ChecklistCompletionSource,
  ChecklistPhase,
  DocKind,
  DocPhase,
  Stage,
} from '@prisma/client';
import { prisma } from './db';
import { buildSteps, SLOT_KINDS } from './checklist-steps';
import { logEvent, notify, notifyStaff, setStage } from './notify';

export class MissingChecklistEvidenceError extends Error {
  constructor(public readonly labels: string[]) {
    super(`Missing required evidence: ${labels.join(', ')}`);
  }
}

export async function missingChecklistEvidence(bookingId: string, phase: ChecklistPhase) {
  const docs = await prisma.document.findMany({
    where: {
      bookingId,
      phase: phase === ChecklistPhase.PICKUP ? DocPhase.PICKUP : DocPhase.DROPOFF,
      deletedAt: null,
    },
    select: { kind: true },
  });
  const have = new Set(docs.map((doc) => doc.kind));
  const missing: Array<{ kind: DocKind; label: string }> = [];

  for (const step of buildSteps(phase)) {
    for (const upload of step.uploads ?? []) {
      if (!upload.required) continue;
      const kindName = SLOT_KINDS[upload.key];
      if (!kindName) continue;
      const kind = DocKind[kindName];
      if (!have.has(kind)) missing.push({ kind, label: upload.label });
    }
  }

  return missing;
}

/**
 * Complete either checklist from the renter flow or the CRM fallback flow.
 * The submittedAt update is the claim: only the first caller sends messages
 * and advances the stage, so a double-click cannot fire the workflow twice.
 */
export async function completeChecklist(input: {
  checklistId: string;
  source: ChecklistCompletionSource;
  actor: string;
  reportedTime: string;
  notes?: string | null;
  overrideReason?: string | null;
}) {
  const checklist = await prisma.checklist.findUnique({
    where: { id: input.checklistId },
    include: {
      booking: {
        select: {
          id: true,
          stage: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
        },
      },
    },
  });
  if (!checklist) throw new Error('Checklist not found.');
  if (checklist.booking.stage === Stage.CANCELLED) throw new Error('This booking was cancelled.');
  if (checklist.submittedAt) return { alreadySubmitted: true, missing: [] as string[] };

  const missing = await missingChecklistEvidence(checklist.bookingId, checklist.phase);
  const overrideReason = input.overrideReason?.trim() || null;
  if (missing.length && !overrideReason) {
    throw new MissingChecklistEvidenceError(missing.map((item) => item.label));
  }

  const now = new Date();
  const claimed = await prisma.checklist.updateMany({
    where: { id: checklist.id, submittedAt: null },
    data: {
      firstName: checklist.firstName ?? checklist.booking.firstName,
      lastName: checklist.lastName ?? checklist.booking.lastName,
      email: checklist.email ?? checklist.booking.email,
      phone: checklist.phone ?? checklist.booking.phone,
      reportedTime: input.reportedTime,
      notes: input.notes?.trim() || null,
      submittedAt: now,
      completionSource: input.source,
      completedBy: input.actor,
      overrideReason,
    },
  });
  if (!claimed.count) return { alreadySubmitted: true, missing: [] as string[] };

  const isReturn = checklist.phase === ChecklistPhase.DROPOFF;
  const sourceLabel = input.source === ChecklistCompletionSource.STAFF ? 'staff' : 'renter';
  const detail = [
    `${isReturn ? 'Returned' : 'Picked up'} at ${input.reportedTime}`,
    input.notes?.trim() ? `“${input.notes.trim()}”` : '',
    missing.length ? `override: ${missing.map((item) => item.label).join(', ')} — ${overrideReason}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  await logEvent(
    checklist.bookingId,
    isReturn ? 'dropoff_checklist' : 'pickup_checklist',
    detail,
    input.actor || sourceLabel,
    { completionSource: input.source, missingKinds: missing.map((item) => item.kind), overrideReason },
  );

  if (isReturn) {
    await setStage(checklist.bookingId, Stage.RETURNED, input.actor, 'Return checklist completed');
    await notify(checklist.bookingId, 'thank_you');
    await notifyStaff(checklist.bookingId, 'returned', {
      reportedTime: input.reportedTime,
      detail: input.notes?.trim() || null,
    });
    if (input.notes?.trim() || overrideReason) {
      await prisma.booking.update({
        where: { id: checklist.bookingId },
        data: {
          needsReview: true,
          reviewNote: [input.notes?.trim(), overrideReason ? `Staff override: ${overrideReason}` : '']
            .filter(Boolean)
            .join(' · '),
        },
      });
    }
  } else {
    await setStage(checklist.bookingId, Stage.IN_USE, input.actor, 'Pickup checklist completed');
    await notifyStaff(checklist.bookingId, 'picked_up', { reportedTime: input.reportedTime });
  }

  return { alreadySubmitted: false, missing: missing.map((item) => item.label) };
}
