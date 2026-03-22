import type { Request, Response, Router } from 'express';
import { prisma } from '@blink/database/src/client';
import { requireClientMembership } from '../clients/guard';

function wrap(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) =>
    fn(req, res).catch((err: unknown) => {
      console.error('[blocklist]', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
    });
}

export function registerBlocklistRoutes(router: Router) {
  // ── List blocked numbers ──────────────────────────────────────────────────
  router.get('/clients/:clientId/blocklist', wrap(async (req, res) => {
    const clientId = String((req.params as Record<string, string>).clientId);
    const membership = await requireClientMembership(req, res, clientId);
    if (!membership) return;

    const numbers = await prisma.blockedNumber.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' }
    });
    res.json(numbers);
  }));

  // ── Add a number to blocklist ─────────────────────────────────────────────
  router.post('/clients/:clientId/blocklist', wrap(async (req, res) => {
    const clientId = String((req.params as Record<string, string>).clientId);
    const membership = await requireClientMembership(req, res, clientId);
    if (!membership) return;

    const rawPhone = String(req.body?.phone ?? '').trim().replace(/\D+/g, '');
    if (!rawPhone) { res.status(400).json({ error: 'phone is required' }); return; }

    const reason = req.body?.reason ? String(req.body.reason).trim() : null;

    const entry = await prisma.blockedNumber.upsert({
      where: { clientId_phone: { clientId, phone: rawPhone } },
      create: { clientId, phone: rawPhone, reason },
      update: { reason }
    });
    res.status(201).json(entry);
  }));

  // ── Remove a number from blocklist ────────────────────────────────────────
  router.delete('/clients/:clientId/blocklist/:id', wrap(async (req, res) => {
    const clientId = String((req.params as Record<string, string>).clientId);
    const id       = String((req.params as Record<string, string>).id);
    const membership = await requireClientMembership(req, res, clientId);
    if (!membership) return;

    const entry = await prisma.blockedNumber.findFirst({ where: { id, clientId } });
    if (!entry) { res.status(404).json({ error: 'Not found' }); return; }

    await prisma.blockedNumber.delete({ where: { id } });
    res.json({ ok: true });
  }));
}
