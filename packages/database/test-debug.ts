import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';

const prisma = new PrismaClient();

async function main() {
  const blocked = await prisma.blockedNumber.findMany();
  let out = '--- ALL BLOCKED NUMBERS ---\n' + JSON.stringify(blocked, null, 2) + '\n';

  const leads = await prisma.lead.findMany({
    where: { phone: { contains: '9943514360' } }
  });
  out += '\n--- LEADS MATCHING 9943514360 ---\n' + JSON.stringify(leads, null, 2) + '\n';

  const insts = await prisma.whatsappInstance.findMany();
  out += '\n--- INSTANCES ---\n' + JSON.stringify(insts, null, 2) + '\n';

  fs.writeFileSync('out_debug.txt', out);
}

main().catch(console.error).finally(() => prisma.$disconnect());
