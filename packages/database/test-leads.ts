import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';

const prisma = new PrismaClient();

async function main() {
  const leads = await prisma.lead.findMany();
  fs.writeFileSync('out_leads.txt', '--- ALL LEADS ---\n' + JSON.stringify(leads, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
