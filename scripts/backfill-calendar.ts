import { prisma } from '../src/lib/db';
import { config } from '../src/lib/config';
import { syncBookingToCalendar } from '../src/lib/calendar-sync';

/**
 * Put existing bookings onto the office calendar.
 *
 * The sync only runs when a booking is created or changed, so anything booked
 * before it existed is invisible to the office. This walks the live ones once.
 *
 *   npx tsx scripts/backfill-calendar.ts          # show what would happen
 *   npx tsx scripts/backfill-calendar.ts --write  # actually write
 *
 * Safe to run twice: event ids are derived from the booking and the day, so a
 * second run corrects the same events rather than duplicating them.
 */
async function main() {
  const write = process.argv.includes('--write');

  if (!config.gcal.enabled) {
    console.error('Google Calendar is not configured — set the three GOOGLE_* variables.');
    process.exit(1);
  }

  // Every event description carries a link back to the CRM, built from
  // config.appUrl. Run this with a local .env and you quietly write a calendar
  // full of http://localhost:3000 links that nobody else can open.
  if (write && config.appUrl.includes('localhost')) {
    console.error(
      [
        `NEXT_PUBLIC_APP_URL is "${config.appUrl}".`,
        'The links written into each event would point at your own machine.',
        'Re-run with the production URL, e.g.',
        '  NEXT_PUBLIC_APP_URL=https://cht-truck-booking.vercel.app npx tsx scripts/backfill-calendar.ts --write',
      ].join('\n'),
    );
    process.exit(1);
  }

  // Finished rentals are history, not something the office needs to see on a
  // calendar they use to decide what is free. --include-past adds them.
  const skipPast = !process.argv.includes('--include-past');

  const bookings = await prisma.booking.findMany({
    where: { stage: { notIn: skipPast ? ['CANCELLED', 'COMPLETED'] : ['CANCELLED'] } },
    include: { truck: { select: { code: true } } },
    orderBy: { blockStart: 'asc' },
  });

  console.log(`${bookings.length} booking(s) to place on "${config.gcal.calendarId.slice(0, 20)}…"\n`);

  for (const b of bookings) {
    const start = b.blockStart.toISOString().slice(0, 10);
    const end = b.blockEnd.toISOString().slice(0, 10);
    const days = Math.round((b.blockEnd.getTime() - b.blockStart.getTime()) / 86_400_000) + 1;
    const label = `${b.firstName} ${b.lastName}`.padEnd(22);

    console.log(`  ${label} ${start} → ${end}  Truck ${b.truck?.code ?? '?'}  ${days} event(s)  [${b.stage}]`);

    if (write) {
      await syncBookingToCalendar(b.id);
    }
  }

  console.log(write ? '\nDone — check the calendar.' : '\nDry run. Re-run with --write to apply.');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
