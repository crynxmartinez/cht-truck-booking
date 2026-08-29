import { PrismaClient } from '@prisma/client';
process.loadEnvFile?.('.env');
const prisma = new PrismaClient();
async function main() {
  const b = await prisma.booking.findFirst({
    where: { reference: { startsWith: 'CHT-TEST' } },
    orderBy: { createdAt: 'desc' },
    include: { truck: true, contracts: true, checklists: true, messages: true, events: { orderBy: { createdAt: 'asc' } } },
  });
  if (!b) return console.log('no test booking');
  console.log(`${b.reference}  stage=${b.stage}  truck=${b.truck?.code}`);
  console.log('contracts:', b.contracts.map(c => `${c.type}=${c.status}${c.signerName ? ` by ${c.signerName}` : ''} pdf=${c.pdfUrl ? 'yes' : 'no'} hash=${c.termsHash?.slice(0,12) ?? '-'}`).join(' | '));
  console.log('checklists:', b.checklists.map(c => `${c.phase}=${c.submittedAt ? 'submitted' : 'pending'}`).join(' | '));
  console.log('messages:', b.messages.map(m => `${m.template}/${m.channel}=${m.status}${m.error ? ` (${m.error.slice(0,50)})` : ''}`).join('\n          '));
  console.log('events:', b.events.map(e => `${e.type}: ${e.detail?.slice(0,70)}`).join('\n        '));
}
main().finally(() => prisma.$disconnect());
