import type { Request, Response, Router } from 'express';
import { prisma } from '@blink/database/src/client';
import { requireClientMembership } from './guard';

export function registerClientRoutes(router: Router) {
  router.get('/clients', async (req: Request, res: Response) => {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const clients = await prisma.client.findMany({
      where: {
        members: {
          some: {
            userId
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    res.json(clients);
  });

  router.post('/clients', async (req: Request, res: Response) => {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { name, slug, industryType, websiteUrl } = req.body ?? {};

    if (!name || !slug) {
      res.status(400).json({ error: 'name and slug are required' });
      return;
    }

    const client = await prisma.client.create({
      data: {
        name,
        slug,
        industryType: industryType ?? null,
        websiteUrl: websiteUrl ?? null,
        members: {
          create: {
            userId,
            role: 'OWNER'
          }
        }
      }
    });

    res.status(201).json(client);
  });

  // Update basic client / business profile fields (e.g., company name)
  router.patch('/clients/:clientId', async (req: Request, res: Response) => {
    const { clientId } = req.params;

    const membership = await requireClientMembership(req, res, clientId);
    if (!membership) return;

    const { name, industryType, websiteUrl } = req.body ?? {};

    const data: any = {};
    if (typeof name === 'string' && name.trim()) {
      data.name = name.trim();
    }
    if (industryType !== undefined) {
      data.industryType = industryType || null;
    }
    if (websiteUrl !== undefined) {
      data.websiteUrl = websiteUrl || null;
    }

    if (!Object.keys(data).length) {
      res.status(400).json({ error: 'No updatable fields provided' });
      return;
    }

    const client = await prisma.client.update({
      where: { id: clientId },
      data
    });

    res.json(client);
  });
}

