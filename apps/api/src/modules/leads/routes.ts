import type { Request, Response, Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';

import multer from 'multer';
import * as xlsx from 'xlsx';

import { prisma } from '@blink/database/src/client';
import { requireClientMembership } from '../clients/guard';

const uploadRoot = path.join(process.cwd(), 'storage', 'uploads', 'clients');

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const clientId = String((req.params as Record<string, string>).clientId ?? 'unknown');
    const dir = path.join(uploadRoot, clientId, 'blocklist');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/[^\w.\-]+/g, '_');
    cb(null, `${Date.now()}-${safeName}`);
  }
});

const upload = multer({ storage });

export function registerLeadRoutes(router: Router) {
  router.get('/clients/:clientId/leads', async (req: Request, res: Response) => {
    const { clientId } = req.params;

    const membership = await requireClientMembership(req, res, clientId);
    if (!membership) return;

    const leads = await prisma.lead.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      take: 100
    });

    res.json(leads);
  });

  router.post('/clients/:clientId/leads/:leadId/block', async (req: Request, res: Response) => {
    const { clientId, leadId } = req.params;

    const membership = await requireClientMembership(req, res, clientId);
    if (!membership) return;

    const lead = await prisma.lead.findFirst({
      where: { id: leadId, clientId }
    });

    if (!lead) {
      res.status(404).json({ error: 'Lead not found for this client' });
      return;
    }

    const updated = await prisma.lead.update({
      where: { id: leadId },
      data: { status: 'BLOCKED' }
    });

    res.json(updated);
  });

  router.post('/clients/:clientId/leads/:leadId/unblock', async (req: Request, res: Response) => {
    const { clientId, leadId } = req.params;

    const membership = await requireClientMembership(req, res, clientId);
    if (!membership) return;

    const lead = await prisma.lead.findFirst({
      where: { id: leadId, clientId }
    });

    if (!lead) {
      res.status(404).json({ error: 'Lead not found for this client' });
      return;
    }

    const updated = await prisma.lead.update({
      where: { id: leadId },
      data: { status: 'NEW' }
    });

    res.json(updated);
  });

  router.get('/clients/:clientId/blocked-numbers', async (req: Request, res: Response) => {
    const { clientId } = req.params;

    const membership = await requireClientMembership(req, res, clientId);
    if (!membership) return;

    const rows = await prisma.blockedNumber.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      take: 200
    });

    res.json(rows);
  });

  router.post('/clients/:clientId/blocked-numbers', async (req: Request, res: Response) => {
    const { clientId } = req.params;
    const { phone, reason } = req.body ?? {};

    const membership = await requireClientMembership(req, res, clientId);
    if (!membership) return;

    const normalized = String(phone || '').replace(/\D+/g, '');
    if (!normalized) {
      res.status(400).json({ error: 'phone is required' });
      return;
    }

    const row = await prisma.blockedNumber.upsert({
      where: {
        clientId_phone: {
          clientId,
          phone: normalized
        }
      },
      update: {
        reason: reason ?? null
      },
      create: {
        clientId,
        phone: normalized,
        reason: reason ?? null
      }
    });

    res.status(201).json(row);
  });

  router.delete('/clients/:clientId/blocked-numbers/:id', async (req: Request, res: Response) => {
    const { clientId, id } = req.params;

    const membership = await requireClientMembership(req, res, clientId);
    if (!membership) return;

    const existing = await prisma.blockedNumber.findFirst({
      where: { id, clientId }
    });

    if (!existing) {
      res.status(404).json({ error: 'Blocked number not found for this client' });
      return;
    }

    await prisma.blockedNumber.delete({ where: { id } });
    res.status(204).end();
  });
  router.post('/clients/:clientId/blocked-numbers/bulk', upload.single('file'), async (req: Request, res: Response) => {
    const clientId = String((req.params as Record<string, string>).clientId);
    const file = req.file;

    const membership = await requireClientMembership(req, res, clientId);
    if (!membership) return;

    if (!file) {
      res.status(400).json({ error: 'file is required' });
      return;
    }

    try {
      const workbook = xlsx.readFile(file.path);
      const ws = workbook.Sheets[workbook.SheetNames[0]!]!;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawRows = xlsx.utils.sheet_to_json<any>(ws);

      let processed = 0;

      for (const row of rawRows) {
        if (!row || typeof row !== 'object') continue;
        
        const phoneKey = Object.keys(row).find(k => k.toLowerCase().includes('phone') || k.toLowerCase().includes('number'));
        const reasonKey = Object.keys(row).find(k => k.toLowerCase().includes('reason'));

        if (!phoneKey) continue;

        const rawPhone = String(row[phoneKey] || '');
        const normalized = rawPhone.replace(/\D+/g, '');
        if (!normalized) continue;

        const reason = reasonKey ? String(row[reasonKey] || '').trim() : null;

        await prisma.blockedNumber.upsert({
          where: {
            clientId_phone: { clientId, phone: normalized }
          },
          update: { reason: reason || undefined },
          create: { clientId, phone: normalized, reason: reason || null }
        });
        
        processed++;
      }

      res.status(201).json({ success: true, total: rawRows.length, processed });
    } catch (e: unknown) {
      console.error('[bulk upload]', e);
      res.status(500).json({ error: e instanceof Error ? e.message : 'Bulk upload failed' });
    }
  });
}

