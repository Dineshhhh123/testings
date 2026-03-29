import type { Request, Response, Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '@blink/database/src/client';
import { requireClientMembership } from './guard';

const uploadDir = path.join(process.cwd(), 'uploads', 'qrcodes');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + '-' + file.originalname.replace(/[^a-zA-Z0-9.]/g, ''));
  }
});
const upload = multer({ storage });

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
      include: {
        businessProfile: true
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

  router.post('/clients/:clientId/payment-qr', upload.single('qrImage'), async (req: Request, res: Response) => {
    const clientId = String(req.params.clientId);
    const membership = await requireClientMembership(req, res, clientId);
    if (!membership) return;

    if (!req.file) {
      res.status(400).json({ error: 'No image file provided' });
      return;
    }

    const client = await prisma.client.findUnique({ where: { id: clientId } });

    // @ts-ignore paymentQrPath is valid per schema updates
    const profile = await prisma.businessProfile.upsert({
      where: { clientId },
      create: {
        clientId,
        businessName: client?.name || 'My Business',
        paymentQrPath: req.file.path
      },
      update: {
        paymentQrPath: req.file.path
      }
    });

    res.json(profile);
  });

  router.delete('/clients/:clientId/payment-qr', async (req: Request, res: Response) => {
    const clientId = String(req.params.clientId);
    const membership = await requireClientMembership(req, res, clientId);
    if (!membership) return;

    try {
      // @ts-ignore paymentQrPath
      const profile = await prisma.businessProfile.update({
        where: { clientId },
        data: { paymentQrPath: null }
      });
      res.json(profile);
    } catch (e) {
      // In case BusinessProfile doesn't exist
      res.json({ success: true });
    }
  });
}

