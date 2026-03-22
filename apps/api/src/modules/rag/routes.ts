import type { Request, Response, Router } from 'express';

import { prisma } from '@blink/database/src/client';
import { requireClientMembership } from '../clients/guard';

export function registerRagRoutes(router: Router) {
  // Simple keyword-based retrieval over ingested chunks
  router.post('/clients/:clientId/rag/query', async (req: Request, res: Response) => {
    const { clientId } = req.params;
    const { query, limit } = req.body ?? {};

    const membership = await requireClientMembership(req, res, clientId);
    if (!membership) return;

    if (!query || typeof query !== 'string') {
      res.status(400).json({ error: 'query is required' });
      return;
    }

    const take = typeof limit === 'number' && limit > 0 && limit <= 50 ? limit : 5;

    const chunks = await prisma.knowledgeChunk.findMany({
      where: {
        clientId,
        content: {
          contains: query,
          mode: 'insensitive'
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take,
      include: {
        source: true
      }
    });

    res.json({
      query,
      count: chunks.length,
      chunks
    });
  });
}

