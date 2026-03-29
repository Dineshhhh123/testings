const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const result = await prisma.$executeRaw`UPDATE "Conversation" SET "whatsappInstanceName" = 'client-dinesh-primary' WHERE "whatsappInstanceName" IS NULL`;
  console.log(`Updated existing conversations with default instance name. Result: ${result}`);
}

main().finally(() => prisma.$disconnect());
