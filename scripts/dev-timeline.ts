process.loadEnvFile?.('.env');
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
prisma.contract.findFirst({
  where: { booking: { reference: 'CHT-G7N6NJ' } },
  select: { status:true, viewedAt:true, signedAt:true, updatedAt:true, signerName:true, payload:true },
}).then(c => {
  console.log('status   ', c?.status);
  console.log('viewedAt ', c?.viewedAt?.toISOString());
  console.log('signedAt ', c?.signedAt?.toISOString(), ' <- this was my reproduction POST');
  console.log('updatedAt', c?.updatedAt.toISOString());
  console.log('stored employer:', (c?.payload as any)?.employer, '(fabricated by me)');
}).finally(()=>prisma.$disconnect());
