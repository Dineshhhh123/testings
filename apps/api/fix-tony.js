const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  await prisma.lead.updateMany({
    where: { displayName: 'Tony' },
    data: { phone: '6389715261' }
  });
  console.log('Tony phone fixed');
}
main().finally(() => prisma.$disconnect());
