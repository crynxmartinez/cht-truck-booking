import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

/**
 * Idempotent seed. Safe to run against a live database — it upserts the two
 * trucks and creates the first admin only if no admin exists yet.
 *
 *   npm run seed
 */

// Running locally, pick up .env. On Vercel the variables are already set.
try {
  process.loadEnvFile?.('.env');
} catch {
  /* no .env file — expected in CI and on Vercel */
}

const prisma = new PrismaClient();

async function main() {
  const trucks = [
    {
      code: 'A',
      plate: process.env.TRUCK_A_PLATE || '764302D',
      year: Number(process.env.TRUCK_A_YEAR || 2022),
      lockboxCode: process.env.TRUCK_A_LOCKBOX || '92584',
    },
    {
      code: 'B',
      plate: process.env.TRUCK_B_PLATE || '705921E',
      year: Number(process.env.TRUCK_B_YEAR || 2021),
      lockboxCode: process.env.TRUCK_B_LOCKBOX || '92584',
    },
  ];

  for (const t of trucks) {
    const row = await prisma.truck.upsert({
      where: { code: t.code },
      // Plate and year are facts about the vehicle; the lockbox code is
      // operational and the office may have already changed it in the CRM,
      // so an existing truck keeps whatever code it has.
      update: { plate: t.plate, year: t.year },
      create: { ...t, active: true },
    });
    console.log(`Truck ${row.code} — ${row.plate} (${row.year})`);
  }

  // The notification list. Seeded from config so day one matches what the
  // system was already configured to do; everything after is managed in the UI.
  const staffEmail = (process.env.STAFF_EMAIL || 'diana@coryhometeam.com').trim().toLowerCase();
  const staffName = process.env.STAFF_NAME || 'Diana Alsup';
  const staffPhone = process.env.STAFF_PHONE || '+15625568184';

  const existing = await prisma.notificationRecipient.findUnique({ where: { email: staffEmail } });
  if (existing) {
    console.log(`Notification recipient ${staffEmail} already exists (${existing.role}).`);
  } else {
    const anyMain = await prisma.notificationRecipient.findFirst({ where: { role: 'MAIN_ADMIN' } });
    const r = await prisma.notificationRecipient.create({
      data: {
        name: staffName,
        email: staffEmail,
        phone: staffPhone,
        role: anyMain ? 'ADMIN' : 'MAIN_ADMIN',
        notifyEmail: true,
        notifySms: true,
        active: true,
      },
    });
    console.log(`Notification recipient created: ${r.name} <${r.email}> as ${r.role}`);
    if (r.role === 'MAIN_ADMIN') {
      console.log('They are the main admin and sign the paperwork — add their signature in the CRM under Notifications.');
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
