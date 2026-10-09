import { prisma } from '../src/lib/db';
import { duePickupMessage, yardClock } from '../src/lib/pickup-release';

/**
 * What would the pickup job send right now? Read-only: it decides, it never
 * sends, so it is safe to point at a live booking.
 *
 *   npx tsx scripts/check-pickup-due.ts Tripp
 */
async function main() {
  const lastName = process.argv[2];
  if (!lastName) {
    console.error('Usage: npx tsx scripts/check-pickup-due.ts <last name>');
    process.exit(1);
  }

  const clock = yardClock();
  console.log(`Yard clock: ${clock.today} hour ${clock.hour}\n`);

  const bookings = await prisma.booking.findMany({
    where: { lastName: { equals: lastName, mode: 'insensitive' }, stage: { notIn: ['CANCELLED', 'COMPLETED'] } },
    select: { id: true, reference: true, firstName: true, lastName: true, stage: true, pickupDate: true },
  });

  for (const b of bookings) {
    const { template, retry } = await duePickupMessage(b.id, clock);
    console.log(
      `${b.firstName} ${b.lastName}  ${b.reference}  stage=${b.stage}  pickup=${b.pickupDate.toISOString().slice(0, 10)}`,
    );
    console.log(`  -> would send: ${template ?? 'nothing'}${retry ? ' (retrying a failed attempt)' : ''}\n`);
  }
  if (!bookings.length) console.log('No open booking with that last name.');

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
