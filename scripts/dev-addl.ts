process.loadEnvFile?.('.env');
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const bs = await prisma.booking.findMany({
    orderBy: { createdAt: 'desc' }, take: 5,
    include: { additionalDriver: true, contracts: true, messages: { orderBy: { createdAt: 'asc' } }, events: { orderBy: { createdAt: 'asc' } } },
  });
  for (const b of bs) {
    console.log(`\n=== ${b.reference}  ${b.stage}  renter=${b.firstName} ${b.lastName} <${b.email}>`);
    console.log(`    additionalDriverRequested = ${b.additionalDriverRequested}`);
    if (b.additionalDriver) {
      const d = b.additionalDriver;
      console.log(`    2nd driver: ${d.name}  email=${d.email ?? '(none)'}  phone=${d.phone ?? '(none)'}`);
    } else {
      console.log('    2nd driver: none recorded');
    }
    for (const c of b.contracts) {
      console.log(`    contract ${c.type.padEnd(18)} ${c.status.padEnd(7)} signer=${c.signerName ?? '-'} to=${c.signerEmail ?? '-'}`);
    }
    console.log('    --- messages ---');
    for (const m of b.messages) {
      console.log(`    ${m.template.padEnd(20)} ${m.channel.padEnd(5)} ${m.status.padEnd(7)} -> ${m.toAddress ?? '?'} ${m.error ? '('+m.error.slice(0,60)+')' : ''}`);
    }
    for (const e of b.events) console.log(`    [${e.type}] ${(e.detail ?? '').slice(0,120)}`);
  }
}
main().finally(()=>prisma.$disconnect());
