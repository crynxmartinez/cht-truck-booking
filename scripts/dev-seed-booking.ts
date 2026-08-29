import { PrismaClient } from '@prisma/client';

/**
 * Creates a complete test booking so you can click through the signing page,
 * both checklists and the CRM before Vercel Blob is connected.
 *
 *   npx tsx scripts/dev-seed-booking.ts            # pickup in 14 days
 *   npx tsx scripts/dev-seed-booking.ts 2026-09-14 # a specific date
 *
 * Documents are stubbed with placeholder URLs — nothing is uploaded. Delete the
 * booking from the CRM when you are done, or just leave it; the reference is
 * prefixed so test rows are easy to spot.
 */

process.loadEnvFile?.('.env');

const prisma = new PrismaClient();

const RENTAL_DAYS = Number(process.env.RENTAL_BLOCK_DAYS || 3);

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}
function addDays(base: Date, n: number) {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}
function token() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url');
}

async function main() {
  const arg = process.argv[2];
  const pickup = arg ? new Date(`${arg}T00:00:00Z`) : addDays(new Date(), 14);
  const pickupIso = iso(pickup);
  const blockEnd = addDays(pickup, RENTAL_DAYS - 1);

  const truck = await prisma.truck.findFirst({ where: { active: true }, orderBy: { code: 'asc' } });
  if (!truck) throw new Error('No trucks. Run `npm run seed` first.');

  const clash = await prisma.booking.findFirst({
    where: {
      truckId: truck.id,
      stage: { notIn: ['COMPLETED', 'CANCELLED'] },
      blockStart: { lte: blockEnd },
      blockEnd: { gte: pickup },
    },
  });
  if (clash) throw new Error(`Truck ${truck.code} is already booked over ${pickupIso} (${clash.reference}).`);

  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  const booking = await prisma.booking.create({
    data: {
      reference: `CHT-TEST${suffix}`,
      stage: 'CONTRACT_SENT',
      truckId: truck.id,
      pickupDate: pickup,
      returnDate: blockEnd,
      blockStart: pickup,
      blockEnd,
      firstName: 'Crystal',
      lastName: 'Reyes',
      email: 'crystal.test@example.com',
      phone: '+19515550147',
      sourceUrl: 'dev-seed',
    },
  });

  for (const kind of ['DRIVER_LICENSE', 'INSURANCE'] as const) {
    await prisma.document.create({
      data: {
        bookingId: booking.id,
        kind,
        phase: 'BOOKING',
        url: `https://placehold.co/600x400/eeeeee/999999.png?text=${kind}`,
        pathname: `dev/${booking.reference}/${kind}.png`,
        contentType: 'image/png',
        bytes: 24_000,
      },
    });
  }

  const contract = await prisma.contract.create({
    data: { bookingId: booking.id, type: 'RENTAL_AGREEMENT', token: token() },
  });
  const pick = await prisma.checklist.create({
    data: { bookingId: booking.id, phase: 'PICKUP', token: token() },
  });
  const drop = await prisma.checklist.create({
    data: { bookingId: booking.id, phase: 'DROPOFF', token: token() },
  });

  await prisma.bookingEvent.create({
    data: { bookingId: booking.id, type: 'booking_created', detail: 'Created by dev-seed-booking', actor: 'dev' },
  });

  const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  console.log('');
  console.log(`Booking ${booking.reference} — Truck ${truck.code}, pickup ${pickupIso}`);
  console.log('');
  console.log('  Sign agreement    ', `${base}/sign/${contract.token}`);
  console.log('  Pickup checklist  ', `${base}/checklist/${pick.token}`);
  console.log('  Drop-off checklist', `${base}/checklist/${drop.token}`);
  console.log('  CRM board         ', `${base}/app`);
  console.log('');
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
