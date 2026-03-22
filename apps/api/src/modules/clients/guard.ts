import type { Request, Response } from 'express';

import { prisma } from '@blink/database/src/client';

export async function requireClientMembership(
  req: Request,
  res: Response,
  clientId: string
) {
  const userId = req.auth?.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }

  const membership = await prisma.clientMember.findFirst({
    where: {
      clientId,
      userId
    }
  });

  if (!membership) {
    res.status(403).json({ error: 'Forbidden: no access to this client' });
    return null;
  }

  return membership;
}

