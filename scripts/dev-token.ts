process.loadEnvFile?.('.env');
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
prisma.contract.findFirst({
  where: { booking: { reference: process.argv[2] } },
  select: { token: true, status: true, type: true, booking: { select: { pickupDate: true, truck: { select: { code: true } } } } },
}).then(c => console.log(JSON.stringify(c))).finally(()=>prisma.$disconnect());
