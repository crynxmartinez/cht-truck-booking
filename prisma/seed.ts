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

  const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const adminPassword = process.env.ADMIN_INITIAL_PASSWORD || '';

  if (!adminEmail || !adminPassword) {
    console.log('No ADMIN_EMAIL / ADMIN_INITIAL_PASSWORD set — skipping admin creation.');
  } else {
    const existing = await prisma.adminUser.findUnique({ where: { email: adminEmail } });
    if (existing) {
      console.log(`Admin ${adminEmail} already exists — password left alone.`);
    } else {
      await prisma.adminUser.create({
        data: {
          email: adminEmail,
          passwordHash: await bcrypt.hash(adminPassword, 10),
          name: 'Cory Home Team',
          role: 'admin',
        },
      });
      console.log(`Admin created: ${adminEmail}`);
      console.log('Change this password after your first sign-in.');
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
