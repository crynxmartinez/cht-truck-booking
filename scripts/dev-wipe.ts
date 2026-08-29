process.loadEnvFile?.('.env');
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

/**
 * Wipes every booking and everything hanging off it, leaving the fleet and the
 * admin account in place so the system still works. Destructive and deliberate.
 */
async function main() {
  const before = {
    bookings: await prisma.booking.count(),
    documents: await prisma.document.count(),
    contracts: await prisma.contract.count(),
    checklists: await prisma.checklist.count(),
    messages: await prisma.messageLog.count(),
    events: await prisma.bookingEvent.count(),
    additionalDrivers: await prisma.additionalDriver.count(),
    blackouts: await prisma.blackoutDate.count(),
  };
  console.log('BEFORE', JSON.stringify(before));

  // Bookings cascade to documents, contracts, checklists, messages, events
  // and additional drivers.
  const del = await prisma.booking.deleteMany({});
  console.log('bookings deleted:', del.count);

  // Anything parked against a draft that never became a booking.
  const orphans = await prisma.document.deleteMany({});
  console.log('leftover documents deleted:', orphans.count);

  const after = {
    bookings: await prisma.booking.count(),
    documents: await prisma.document.count(),
    contracts: await prisma.contract.count(),
    checklists: await prisma.checklist.count(),
    messages: await prisma.messageLog.count(),
    events: await prisma.bookingEvent.count(),
    additionalDrivers: await prisma.additionalDriver.count(),
    blackouts: await prisma.blackoutDate.count(),
  };
  console.log('AFTER ', JSON.stringify(after));

  const trucks = await prisma.truck.findMany({ orderBy: { code: 'asc' } });
  console.log('\nKEPT — fleet:');
  for (const t of trucks) {
    console.log(`  Truck ${t.code}  plate ${t.plate}  ${t.year}  lockbox ${t.lockboxCode}  ${t.active ? 'bookable' : 'off calendar'}`);
  }
  console.log('KEPT — admin rows:', await prisma.adminUser.count());
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
