const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const convos = await prisma.conversation.findMany({
    where: { leadId: { not: null } }
  });

  let count = 0;
  for (const c of convos) {
    const lead = await prisma.lead.findUnique({ where: { id: c.leadId } });
    if (lead && lead.conversationId !== c.id) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { conversationId: c.id }
      });
      count++;
    }
  }

  console.log(`Fixed ${count} leads by linking conversationId.`);
}

main().finally(() => prisma.$disconnect());
