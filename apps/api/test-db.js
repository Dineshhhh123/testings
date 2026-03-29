const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const fs = require('fs');

async function main() {
  const leads = await prisma.lead.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5
  });

  const convos = await prisma.conversation.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 5,
    include: { lead: true }
  });

  fs.writeFileSync('test-db-out.utf8.json', JSON.stringify({ leads, convos }, null, 2));
}

main().finally(() => prisma.$disconnect());
