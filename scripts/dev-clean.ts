process.loadEnvFile?.('.env');
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const rows = await prisma.booking.findMany({ where: { reference: { startsWith: 'CHT-TEST' } }, select: { id: true, reference: true } });
  for (const b of rows) {
    await prisma.booking.delete({ where: { id: b.id } }); // cascades to docs/contracts/checklists/messages/events
    console.log('deleted', b.reference);
  }
  await prisma.document.deleteMany({ where: { bookingId: null } });
  console.log('orphan documents cleared');
  const counts = {
    bookings: await prisma.booking.count(),
    documents: await prisma.document.count(),
    trucks: await prisma.truck.count(),
    admins: await prisma.adminUser.count(),
  };
  console.log('remaining:', JSON.stringify(counts));
}
main().finally(()=>prisma.$disconnect());
