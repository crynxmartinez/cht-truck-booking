import { prisma } from '../src/lib/db';
import { config } from '../src/lib/config';
import { expectedEventsFor } from '../src/lib/calendar-sync';
import { addDays, dateToIso, todayInOps } from '../src/lib/dates';
import { listEvents } from '../src/lib/gcal';
import { diffCalendar, findOverlaps, wrongTruckCode, type HoldRow } from '../src/lib/invariants';
import { GUARDED_STAGES, OVERLAP_CONSTRAINT } from '../src/lib/overlap-guard';

/**
 * Is the system actually consistent right now? Read-only.
 *
 *   npx tsx --env-file=.env scripts/check-invariants.ts
 *
 * Asks the live database and Google Calendar — not our own code's opinion of
 * itself — and exits non-zero if anything is wrong. Run it after any batch of
 * truck moves, and whenever something looks off.
 */

type Result = { name: string; status: 'PASS' | 'FAIL' | 'WARN' | 'SKIP'; detail: string[] };
const results: Result[] = [];
/**
 * `level` is how bad a problem is. A WARN is printed but never fails the run:
 * it is for things only a person can judge, like bookings left on a truck
 * that is switched off — fine when bookings are merely paused, a problem when
 * the truck is out of service.
 */
const record = (name: string, problems: string[], skip?: string, level: 'FAIL' | 'WARN' = 'FAIL') =>
  results.push(
    skip
      ? { name, status: 'SKIP', detail: [skip] }
      : { name, status: problems.length ? level : 'PASS', detail: problems },
  );

const HOLDING = [...GUARDED_STAGES];
const PRE_COLLECTION = ['CONFIRMED', 'PICKUP_DAY'];

async function main() {
  const today = todayInOps();
  const trucks = await prisma.truck.findMany({ orderBy: { code: 'asc' } });
  const byId = new Map(trucks.map((t) => [t.id, t]));

  const holding = await prisma.booking.findMany({
    where: { stage: { in: HOLDING } },
    include: { truck: { select: { code: true } } },
    orderBy: { pickupDate: 'asc' },
  });

  // 1. Every booking that holds a truck has one.
  record(
    'every booking holding a truck has one assigned',
    holding.filter((b) => !b.truckId).map((b) => `${b.reference} (${b.firstName} ${b.lastName}) has no truck`),
  );

  // 2. Nothing overlaps on a truck.
  const rows: HoldRow[] = holding.map((b) => ({
    id: b.id,
    reference: b.reference,
    truckId: b.truckId,
    blockStart: dateToIso(b.blockStart),
    blockEnd: dateToIso(b.blockEnd),
    stage: b.stage,
  }));
  record(
    'no truck is held by two bookings on the same day',
    findOverlaps(rows).map(([a, b]) => `${a.reference} (${a.blockStart}–${a.blockEnd}) and ${b.reference} (${b.blockStart}–${b.blockEnd})`),
  );

  // 3. Nothing upcoming sits on a switched-off truck.
  record(
    'no upcoming booking sits on a truck that is switched off',
    holding
      .filter((b) => b.truckId && byId.get(b.truckId)?.active === false && dateToIso(b.blockEnd) >= today)
      .map((b) => `${b.reference} (${b.firstName} ${b.lastName}) is on Truck ${b.truck?.code}, which is off — fine if you are only pausing new bookings; move them if the truck is out of service`),
    undefined,
    'WARN',
  );

  // 4. No message carries another truck's lockbox code.
  const codes = trucks.map((t) => ({ id: t.id, code: t.lockboxCode }));
  const waiting = holding.filter((b) => PRE_COLLECTION.includes(b.stage));
  const messages = waiting.length
    ? await prisma.messageLog.findMany({
        where: {
          bookingId: { in: waiting.map((b) => b.id) },
          recipientKey: 'renter',
          template: { in: ['pickup_morning', 'pickup_reminder', 'pickup_no_show_check'] },
          status: 'SENT',
        },
        select: { bookingId: true, template: true, channel: true, body: true },
      })
    : [];
  const wrongCode: string[] = [];
  for (const m of messages) {
    const b = waiting.find((x) => x.id === m.bookingId)!;
    const own = codes.find((c) => c.id === b.truckId)?.code ?? null;
    const others = codes.filter((c) => c.id !== b.truckId).map((c) => c.code);
    if (wrongTruckCode(m.body ?? '', own, others)) {
      wrongCode.push(`${b.reference}: the ${m.template} ${m.channel} that was sent carries another truck's code`);
    }
  }
  record('no pickup message sent to a waiting renter carries another truck’s code', wrongCode);

  // 5. The Google calendar matches the bookings, event for event.
  if (!config.gcal.enabled) {
    record('the Google calendar matches the bookings one for one', [], 'Google Calendar is not configured here.');
  } else if (holding.length === 0) {
    record('the Google calendar matches the bookings one for one', [], 'No truck-holding bookings.');
  } else {
    const expected = holding.flatMap((b) =>
      expectedEventsFor({
        id: b.id, reference: b.reference, firstName: b.firstName, lastName: b.lastName, email: b.email,
        phone: b.phone, blockStart: b.blockStart, blockEnd: b.blockEnd, stage: b.stage, truck: b.truck,
      }),
    );
    // A finished booking's events are kept as history on purpose. They are not
    // expected, but they are not strays either, so tell the diff they are known.
    const finished = await prisma.booking.findMany({
      where: { stage: 'COMPLETED' },
      include: { truck: { select: { code: true } } },
    });
    const known = finished.flatMap((b) =>
      expectedEventsFor({
        id: b.id, reference: b.reference, firstName: b.firstName, lastName: b.lastName, email: b.email,
        phone: b.phone, blockStart: b.blockStart, blockEnd: b.blockEnd, stage: b.stage, truck: b.truck,
      }).map((e) => e.id),
    );

    const first = rows.reduce((m, r) => (r.blockStart < m ? r.blockStart : m), rows[0].blockStart);
    const last = rows.reduce((m, r) => (r.blockEnd > m ? r.blockEnd : m), rows[0].blockEnd);
    // Wide on BOTH sides, in UTC. A 6 AM event on the first day is the previous
    // day in UTC for anywhere east of Greenwich, so a window that starts at the
    // first day's midnight can miss it entirely. A day of slack each way is
    // harmless: anything extra is judged against the bookings like the rest.
    const read = await listEvents(
      config.gcal.calendarId,
      `${addDays(first, -1)}T00:00:00Z`,
      `${addDays(last, 2)}T00:00:00Z`,
    );
    if (!read.ok) {
      record('the Google calendar matches the bookings one for one', [`could not read the calendar: ${read.error}`]);
    } else {
      const diff = diffCalendar(expected, read.data, known);
      const problems = [
        ...diff.missing.map((id) => `missing from Google: ${id}`),
        ...diff.wrong.map((w) => `wrong on Google: "${w.actual.summary}" (colour ${w.actual.colorId}) should be "${w.expected.summary}" (colour ${w.expected.colorId})`),
        ...diff.orphans.map((id) => `on Google but owned by no booking: ${id}`),
      ];
      record(`the Google calendar matches the bookings one for one (${expected.length} events checked)`, problems);
    }
  }

  // 6. The database guard is in place.
  const guard = await prisma.$queryRawUnsafe<Array<{ conname: string }>>(
    `SELECT conname FROM pg_constraint WHERE conname = '${OVERLAP_CONSTRAINT}'`,
  );
  record('the database refuses overlapping bookings by itself (guard installed)', guard.length ? [] : [`${OVERLAP_CONSTRAINT} is not installed — run scripts/apply-overlap-guard.ts --apply`]);

  // -------------------------------------------------------------- report
  console.log(`Checked ${holding.length} truck-holding booking(s), ${trucks.length} trucks, as of ${today}.\n`);
  for (const r of results) {
    console.log(`${r.status}  ${r.name}`);
    for (const d of r.detail) console.log(`        ${d}`);
  }
  const count = (s: Result['status']) => results.filter((r) => r.status === s).length;
  const failed = count('FAIL');
  console.log(`\n${count('PASS')} passed, ${failed} failed, ${count('WARN')} to look at, ${count('SKIP')} skipped.`);
  if (failed) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
