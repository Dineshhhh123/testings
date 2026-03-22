import type { Request, Response, Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';

import { prisma } from '@blink/database/src/client';
import { requireClientMembership } from '../clients/guard';
import { generateQuotationPdfForQuote } from './pdf';

export function registerQuotationRoutes(router: Router) {
  // List quotations for a client, optionally filtered by leadId
  router.get('/clients/:clientId/quotations', async (req: Request, res: Response) => {
    const { clientId } = req.params;
    const { leadId } = req.query as { leadId?: string };

    const membership = await requireClientMembership(req, res, clientId);
    if (!membership) return;

    const where: any = {
      clientId
    };
    if (leadId) {
      where.leadId = leadId;
    }

    const quotations = await prisma.quotation.findMany({
      where,
      include: {
        lead: true
      },
      orderBy: { createdAt: 'desc' }
    });

    const mapped = quotations.map((q) => {
      const summary: any = q.summary || {};
      const items: any[] = Array.isArray(summary.items)
        ? summary.items
        : [
            {
              category: summary.category,
              productName: summary.productName,
              packQuantity: summary.packQuantity,
              rate: summary.rate,
              quantity: summary.quantity,
              total: summary.total
            }
          ].filter((i) => i.productName);

      const grandTotal =
        typeof summary.grandTotal === 'number'
          ? summary.grandTotal
          : items.reduce((sum, item) => {
              const rate = Number(item.rate ?? 0);
              const quantity = Number(item.quantity ?? 0);
              const total = Number(item.total ?? rate * quantity);
              return sum + total;
            }, 0);

      return {
        id: q.id,
        status: q.status,
        createdAt: q.createdAt,
        sentAt: q.sentAt,
        lead: q.lead
          ? {
              id: q.lead.id,
              displayName: q.lead.displayName,
              phone: q.lead.phone
            }
          : null,
        itemCount: items.length,
        grandTotal,
        hasPdf: !!q.pdfPath
      };
    });

    res.json(mapped);
  });

  // Download or stream quotation PDF; regenerates if needed
  router.get(
    '/clients/:clientId/quotations/:quotationId/pdf',
    async (req: Request, res: Response) => {
      const { clientId, quotationId } = req.params;

      const membership = await requireClientMembership(req, res, clientId);
      if (!membership) return;

      const quotation = await prisma.quotation.findFirst({
        where: { id: quotationId, clientId }
      });

      if (!quotation) {
        res.status(404).json({ error: 'Quotation not found for this client' });
        return;
      }

      let pdfPath = quotation.pdfPath;

      try {
        const { filePath, fileName } = await generateQuotationPdfForQuote(quotationId);
        pdfPath = filePath;

        // Persist pdfPath for future quick access
        if (quotation.pdfPath !== filePath) {
          await prisma.quotation.update({
            where: { id: quotationId },
            data: { pdfPath: filePath, sentAt: quotation.sentAt ?? new Date() }
          });
        }

        const absPath = path.isAbsolute(filePath)
          ? filePath
          : path.join(process.cwd(), filePath);

        if (!fs.existsSync(absPath)) {
          res.status(500).json({ error: 'Generated PDF file not found on disk' });
          return;
        }

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
        fs.createReadStream(absPath).pipe(res);
      } catch (e: any) {
        res
          .status(500)
          .json({ error: e?.message ?? 'Failed to generate or stream quotation PDF' });
      }
    }
  );
}

