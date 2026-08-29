process.loadEnvFile?.('.env');
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const bs = await prisma.booking.findMany({
    orderBy: { createdAt: 'desc' }, take: 6,
    include: { truck: true, contracts: true, events: { orderBy: { createdAt: 'asc' } }, messages: true, additionalDriver: true },
  });
  for (const b of bs) {
    console.log(`\n=== ${b.reference}  ${b.stage}  truck=${b.truck?.code}  ${b.firstName} ${b.lastName} <${b.email}>`);
    console.log(`    created ${b.createdAt.toISOString()}  addlDriver=${b.additionalDriverRequested}`);
    for (const c of b.contracts) {
      console.log(`    contract ${c.type} ${c.status} signed=${c.signedAt?.toISOString() ?? '-'} pdf=${c.pdfPathname ? 'yes':'no'} sigLen=${c.signatureData?.length ?? 0}`);
    }
    for (const e of b.events) console.log(`    [${e.type}] ${(e.detail ?? '').slice(0,140)}`);
    for (const m of b.messages) console.log(`    msg ${m.template}/${m.channel}=${m.status} ${m.error ? '('+m.error.slice(0,70)+')' : ''}`);
  }
}
main().finally(()=>prisma.$disconnect());
