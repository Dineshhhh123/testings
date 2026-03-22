import type { Request, Response, Router } from 'express';

import { prisma } from '@blink/database/src/client';

import { requireClientMembership } from '../clients/guard';

export function registerConversationRoutes(router: Router) {
  // List conversations for a client (latest first)
  router.get('/clients/:clientId/conversations', async (req: Request, res: Response) => {
    const { clientId } = req.params;

    const membership = await requireClientMembership(req, res, clientId);
    if (!membership) return;

    const conversations = await prisma.conversation.findMany({
      where: { clientId },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      include: {
        lead: true
      }
    });

    res.json(conversations);
  });

  // List messages within a conversation
  router.get(
    '/clients/:clientId/conversations/:conversationId/messages',
    async (req: Request, res: Response) => {
      const { clientId, conversationId } = req.params;

      const membership = await requireClientMembership(req, res, clientId);
      if (!membership) return;

      const conversation = await prisma.conversation.findFirst({
        where: { id: conversationId, clientId },
        include: {
          lead: true
        }
      });

      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found for this client' });
        return;
      }

      const messages = await prisma.message.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: 'asc' },
        take: 500
      });

      res.json({
        conversation,
        messages
      });
    }
  );
}

