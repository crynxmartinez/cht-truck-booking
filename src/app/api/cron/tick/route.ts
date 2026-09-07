import { Stage } from '@prisma/client';
import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { addDays, hourInOps, isoToDate, todayInOps } from '@/lib/dates';
import { isAuthorisedCron } from '@/lib/auth';
import { json } from '@/lib/http';
import { logEvent, notify, notifyStaff, setStage } from '@/lib/notify';
import { purgeAbandonedDrafts, purgeToTarget, reconcileOrphanBlobs } from '@/lib/storage';
import { cancelBooking } from '@/lib/bookings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * The single hourly heartbeat.
 *
 * Vercel schedules cron in UTC and California moves twice a year, so a fixed
 * UTC hour would drift the 6 AM text by an hour for half the year. Instead this
 * runs every hour, asks what time it is in Murrieta, and dispatches whatever is
 * due. Every send is idempotent at the database level, so running it twice in
 * the same hour is harmless.
 */
export async function GET(req: Request) {
  if (!isAuthorisedCron(req)) return json({ error: 'Unauthorised' }, { status: 401 });

  const url = new URL(req.url);
  const forceJob = url.searchParams.get('job'); // manual trigger for testing
  const hour = hourInOps();
  const today = todayInOps();

  const ran: Record<string, unknown> = { hour, today, jobs: {} as Record<string, unknown> };
  const jobs = ran.jobs as Record<string, unknown>;

  const should = (name: string, atHour: number) => forceJob === name || (!forceJob && hour === atHour);

  try {
    if (should('pickup', config.pickupSmsHour)) jobs.pickup = await pickupMorning(today);
    if (should('return', config.returnSmsHour)) jobs.return = await returnDay(today);
    if (should('nopickup', config.noPickupCheckHour)) jobs.nopickup = await noPickupCheck(today);
    if (should('sweep', config.dailySweepHour)) jobs.sweep = await dailySweep(today);
  } catch (err) {
    console.error('cron tick failed', err);
    return json({ ok: false, error: String(err), ...ran }, { status: 500 });
  }

  return json({ ok: true, ...ran });
}

/** Vercel's scheduler issues GET; allow POST so external schedulers work too. */
export const POST = GET;

// ---------------------------------------------------------------- 6:00 AM

async function pickupMorning(today: string) {
  const due = await prisma.booking.findMany({
    where: { stage: Stage.CONFIRMED, pickupDate: isoToDate(today) },
    select: { id: true, reference: true },
  });

  const results: string[] = [];
  for (const b of due) {
    const res = await notify(b.id, 'pickup_morning');
    await setStage(b.id, Stage.PICKUP_DAY, 'system', 'Pickup day — lockbox code sent');
    results.push(`${b.reference}: sent ${res.sent.join('+') || 'none'}${res.errors.length ? ` (${res.errors.join('; ')})` : ''}`);
  }
  return { count: due.length, results };
}

// ---------------------------------------------------------------- 7:00 AM

async function returnDay(today: string) {
  const due = await prisma.booking.findMany({
    where: { stage: { in: [Stage.IN_USE, Stage.PICKUP_DAY] }, returnDate: isoToDate(today) },
    select: { id: true, reference: true },
  });

  const results: string[] = [];
  for (const b of due) {
    const res = await notify(b.id, 'return_day');
    results.push(`${b.reference}: sent ${res.sent.join('+') || 'none'}`);
  }
  return { count: due.length, results };
}

// ---------------------------------------------------------------- 2:00 PM

async function noPickupCheck(today: string) {
  const stuck = await prisma.booking.findMany({
    where: {
      stage: Stage.PICKUP_DAY,
      pickupDate: isoToDate(today),
      checklists: { some: { phase: 'PICKUP', submittedAt: null } },
    },
    select: { id: true, reference: true },
  });

  for (const b of stuck) await notify(b.id, 'pickup_no_show_check');
  return { count: stuck.length };
}

// ---------------------------------------------------------------- 9:00 AM

async function dailySweep(today: string) {
  const out: Record<string, unknown> = {};

  // --- unsigned contract nudges
  const cutoff24 = new Date(Date.now() - 24 * 3600_000);
  const cutoff48 = new Date(Date.now() - 48 * 3600_000);

  const unsigned = await prisma.booking.findMany({
    where: {
      stage: { in: [Stage.CONTRACT_SENT, Stage.ADDITIONAL_DRIVER] },
      createdAt: { lte: cutoff24 },
      pickupDate: { gte: isoToDate(today) },
    },
    select: { id: true, reference: true, createdAt: true },
  });
  for (const b of unsigned) await notify(b.id, 'contract_nudge');
  out.nudged = unsigned.length;

  // --- release trucks held by contracts nobody signed
  const staleCutoff = new Date(Date.now() - config.unsignedReleaseHours * 3600_000);
  const stale = await prisma.booking.findMany({
    where: {
      stage: { in: [Stage.CONTRACT_SENT, Stage.ADDITIONAL_DRIVER] },
      createdAt: { lte: staleCutoff },
    },
    select: { id: true, reference: true },
  });
  for (const b of stale) {
    await cancelBooking(b.id, `Auto-released — unsigned after ${config.unsignedReleaseHours} hours`, 'system');
  }
  out.released = stale.length;

  // --- overdue
  const overdueCutoff = isoToDate(addDays(today, -1));
  const late = await prisma.booking.findMany({
    where: {
      stage: { in: [Stage.IN_USE, Stage.PICKUP_DAY] },
      returnDate: { lte: overdueCutoff },
    },
    select: { id: true, reference: true, overdue: true },
  });
  for (const b of late) {
    if (!b.overdue) {
      await prisma.booking.update({ where: { id: b.id }, data: { overdue: true } });
      await logEvent(b.id, 'overdue', 'Truck not returned by the due date', 'system');
      // Only on the day it tips over. The renter keeps getting nudged daily;
      // the office does not need the same text every morning.
      await notifyStaff(b.id, 'overdue');
    }
    await notify(b.id, 'overdue');
  }
  out.overdue = late.length;

  // --- auto-close returned bookings the office has not reviewed in 48h
  const reviewCutoff = new Date(Date.now() - 48 * 3600_000);
  const toClose = await prisma.booking.findMany({
    where: { stage: Stage.RETURNED, needsReview: false, updatedAt: { lte: reviewCutoff } },
    select: { id: true },
  });
  for (const b of toClose) {
    const { completeBooking } = await import('@/lib/bookings');
    await completeBooking(b.id, 'system');
  }
  out.closed = toClose.length;

  // --- uploads from bookings nobody ever completed
  // Deleted outright rather than queued behind the quota rule: these are ID
  // documents belonging to someone who never became a customer.
  try {
    out.abandonedDrafts = await purgeAbandonedDrafts(7);
  } catch (err) {
    out.abandonedDrafts = { error: String(err) };
  }

  // --- storage
  try {
    // Reconcile first: a blob whose row was cascade-deleted is invisible to the
    // quota-driven purge, so it would otherwise sit there forever.
    out.orphanBlobs = await reconcileOrphanBlobs();
  } catch (err) {
    out.orphanBlobs = { error: String(err) };
  }
  try {
    out.storage = await purgeToTarget();
  } catch (err) {
    out.storage = { error: String(err) };
  }

  return out;
}
