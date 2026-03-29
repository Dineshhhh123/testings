import type { Request, Response, Router } from 'express';
import { prisma } from '@blink/database/src/client';

import { requireClientMembership } from '../clients/guard';
import { connectEvolutionInstance, ensureEvolutionInstance, logoutEvolutionInstance } from './evolutionClient';

function mapEvolutionStatus(status?: string | null): string {
  const raw = (status || '').toLowerCase();
  if (!raw) return 'DISCONNECTED';
  if (raw === 'open') return 'CONNECTED';
  if (raw === 'connecting') return 'CONNECTING';
  if (raw === 'close' || raw === 'closed') return 'DISCONNECTED';
  return 'ERROR';
}

export function registerWhatsappRoutes(router: Router) {
  // List instances for a client
  router.get('/clients/:clientId/instances', async (req: Request, res: Response) => {
    const { clientId } = req.params;
    const membership = await requireClientMembership(req, res, clientId);
    if (!membership) return;
    const instances = await prisma.whatsappInstance.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' }
    });
    res.json(instances);
  });

  // Create / sync an Evolution instance and store basic status + QR info
  router.post('/clients/:clientId/instances', async (req: Request, res: Response) => {
    const { clientId } = req.params;
    const { instanceName } = req.body ?? {};

    const membership = await requireClientMembership(req, res, clientId);
    if (!membership) return;

    if (!instanceName) {
      res.status(400).json({ error: 'instanceName is required' });
      return;
    }

    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    try {
      // 1) Ensure Evolution instance exists
      await ensureEvolutionInstance(instanceName);

      // 2) Ask Evolution to connect and return QR (image/base64) or pairing code + status
      const connectResult = await connectEvolutionInstance(instanceName);
      const external = connectResult.instance;
      const anyResult = connectResult as any;
      const qr =
        anyResult.base64 ?? anyResult.qrcode ?? anyResult.pairingCode ?? null;
      const status = mapEvolutionStatus(external?.status);

      // 3) Upsert our local record
      const instance = await prisma.whatsappInstance.upsert({
        where: { instanceName },
        create: {
          clientId,
          instanceName,
          externalInstanceId: external?.instanceId ?? null,
          status,
          qrCode: typeof qr === 'string' ? qr : JSON.stringify(qr),
          metadata: connectResult as any
        },
        update: {
          externalInstanceId: external?.instanceId ?? null,
          status,
          qrCode: typeof qr === 'string' ? qr : JSON.stringify(qr),
          metadata: connectResult as any,
          lastError: null
        }
      });

      res.status(201).json(instance);
    } catch (err: any) {
      const message = String(err?.message || 'Unknown error');
      const instance = await prisma.whatsappInstance.upsert({
        where: { instanceName },
        create: {
          clientId,
          instanceName,
          status: 'ERROR',
          lastError: message
        },
        update: {
          status: 'ERROR',
          lastError: message
        }
      });
      res.status(502).json({ error: 'Evolution API error', details: message, instance });
    }
  });

  // Disconnect an active instance
  router.delete('/clients/:clientId/instances/:instanceName/connection', async (req: Request, res: Response) => {
    const clientId = String(req.params.clientId);
    const instanceName = String(req.params.instanceName);
    const membership = await requireClientMembership(req, res, clientId);
    if (!membership) return;

    try {
      await logoutEvolutionInstance(instanceName);
      const instance = await prisma.whatsappInstance.update({
        where: { instanceName },
        data: {
          status: 'DISCONNECTED',
          qrCode: null,
          lastError: null
        }
      });
      res.json(instance);
    } catch (err: any) {
      const message = String(err?.message || 'Unknown error');
      const instance = await prisma.whatsappInstance.update({
        where: { instanceName },
        data: { status: 'DISCONNECTED', qrCode: null, lastError: message }
      });
      res.status(502).json({ error: 'Failed to disconnect', details: message, instance });
    }
  });
}

