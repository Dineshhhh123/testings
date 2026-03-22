import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';

const prisma = new PrismaClient();

async function main() {
  const blocked = await prisma.blockedNumber.findMany({
    include: { client: true }
  });
  let out = '--- BLOCKED NUMBERS ---\n' + JSON.stringify(blocked, null, 2) + '\n';

  const leads = await prisma.lead.findMany({
    where: { phone: { contains: '8300354542' } }
  });
  out += '\n--- LEADS MATCHING 8300354542 ---\n' + JSON.stringify(leads, null, 2) + '\n';

  const instances = await prisma.whatsappInstance.findMany();
  out += '\n--- INSTANCES ---\n' + JSON.stringify(instances, null, 2) + '\n';

  fs.writeFileSync('out.txt', out);
}

main().catch(console.error).finally(() => prisma.$disconnect());
