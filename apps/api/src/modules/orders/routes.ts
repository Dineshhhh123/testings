import type { Request, Response, Router } from 'express';
import { prisma } from '@blink/database/src/client';
import { requireClientMembership } from '../clients/guard';

export function registerOrderRoutes(router: Router) {
  router.get('/clients/:clientId/orders', async (req: Request, res: Response) => {
    const clientId = String(req.params.clientId);
    const membership = await requireClientMembership(req, res, clientId);
    if (!membership) return;

    // @ts-ignore
    const orders = await prisma.order.findMany({
      where: { clientId },
      include: { lead: true },
      orderBy: { createdAt: 'desc' }
    });

    res.json(orders);
  });

  router.patch('/clients/:clientId/orders/:orderId/verify', async (req: Request, res: Response) => {
    const clientId = String(req.params.clientId);
    const orderId = String(req.params.orderId);
    
    const membership = await requireClientMembership(req, res, clientId);
    if (!membership) return;

    try {
      // @ts-ignore
      const order = await prisma.order.update({
        where: { id: orderId, clientId },
        data: {
          status: 'PAYMENT_SUCCESS',
          paymentVerifiedAt: new Date()
        }
      });
      res.json(order);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to update order' });
    }
  });
}
