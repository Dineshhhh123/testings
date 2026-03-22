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
    const dir = path.join(uploadRoot, clientId, 'pricing');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/[^\w.\-]+/g, '_');
    cb(null, `${Date.now()}-${safeName}`);
  }
});

const upload = multer({ storage });

/** Tiny wrapper so uncaught async errors become 500s instead of hanging requests */
function wrap(
  fn: (req: Request, res: Response) => Promise<void>
): (req: Request, res: Response) => void {
  return (req, res) => {
    fn(req, res).catch((err: unknown) => {
      console.error('[pricing]', err);
      if (!res.headersSent) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
      }
    });
  };
}

export function registerPricingRoutes(router: Router) {

  // ── Upload & parse a pricing sheet ────────────────────────────────────────
  router.post(
    '/clients/:clientId/pricing/upload',
    upload.single('file'),
    wrap(async (req, res) => {
      const clientId = String((req.params as Record<string, string>).clientId);
      const file = req.file;

      const membership = await requireClientMembership(req, res, clientId);
      if (!membership) return;

      if (!file) { res.status(400).json({ error: 'file is required' }); return; }

      const client = await prisma.client.findUnique({ where: { id: clientId } });
      if (!client) { res.status(404).json({ error: 'Client not found' }); return; }

      const relPath = path.relative(process.cwd(), file.path);
      const sheet = await prisma.pricingSheet.create({
        data: { clientId, title: file.originalname, filePath: relPath, status: 'PROCESSING' }
      });

      try {
        const workbook = xlsx.readFile(file.path);
        const ws = workbook.Sheets[workbook.SheetNames[0]!]!;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawRows = xlsx.utils.sheet_to_json<any>(ws);

        // Log first 3 rows so we can see actual column names in the API terminal
        console.log('[upload] total rows:', rawRows.length);
        rawRows.slice(0, 3).forEach((r, i) => console.log(`[upload] row[${i}]:`, JSON.stringify(r)));

        // Normalise a column header key: lowercase + strip all non-alphanumeric chars
        // e.g. "Rate (INR)" → "rateinr", "Pack Quantity" → "packquantity"
        const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

        // Build a lookup map of normalised key → value for each row
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        function buildRowMap(raw: Record<string, any>) {
          const out: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(raw)) {
            out[norm(k)] = v;
          }
          return out;
        }

        // Find a value whose normalised key STARTS WITH any of the given prefixes
        function findCol(rowMap: Record<string, unknown>, ...prefixes: string[]): unknown {
          for (const prefix of prefixes) {
            const p = norm(prefix);
            for (const [k, v] of Object.entries(rowMap)) {
              if (k.startsWith(p)) return v;
            }
          }
          return null;
        }

        function numOrNull(v: unknown): number | null {
          if (v === null || v === undefined || v === '') return null;
          const n = Number(v);
          return Number.isFinite(n) ? n : null;
        }

        const itemsData = rawRows
          .map((raw) => {
            const row = buildRowMap(raw as Record<string, unknown>);

            const category = String(findCol(row, 'category') ?? '').trim();
            const product  = String(findCol(row, 'product')  ?? '').trim();
            if (!category || !product) return null;

            const variantRaw = findCol(row, 'variant');
            const variant = variantRaw != null ? String(variantRaw).trim() || null : null;

            // Pack quantity — "Pack Quantity", "PackQty", "Pack", "Qty"
            const packQuantity = numOrNull(findCol(row, 'packquantity', 'packqty', 'pack', 'qty'));

            // Rate — "Rate", "Rate (INR)", "Price", "MRP", "Amount", "Unit Price"
            const rate = numOrNull(findCol(row, 'rate', 'price', 'mrp', 'amount', 'unitprice', 'unitrate'));

            // Discount — "Discount", "Disc", "Off"
            const discount = numOrNull(findCol(row, 'discount', 'disc', 'off'));

            console.log(`[upload] parsed: product="${product}" rate=${rate} discount=${discount}`);

            return { category, product, variant, packQuantity, rate, discount };
          })
          .filter((x): x is NonNullable<typeof x> => !!x);

        // Load all existing items for this client keyed by lowercase product name
        const existingItems = await prisma.pricingItem.findMany({ where: { clientId } });
        const existingMap = new Map(
          existingItems.map((it) => [it.product.toLowerCase(), it])
        );

        let created = 0;
        let updated = 0;

        for (const item of itemsData) {
          const existing = existingMap.get(item.product.toLowerCase());
          if (existing) {
            // Product already exists → update it in place
            await prisma.pricingItem.update({
              where: { id: existing.id },
              data: {
                category: item.category,
                variant:  item.variant,
                packQuantity: item.packQuantity,
                rate:     item.rate,
                discount: item.discount ?? undefined
              }
            });
            updated++;
          } else {
            // New product → create
            await prisma.pricingItem.create({
              data: {
                clientId,
                pricingSheetId: sheet.id,
                category: item.category,
                product: item.product,
                variant: item.variant,
                packQuantity: item.packQuantity,
                rate: item.rate,
                discount: item.discount,
                currency: 'INR'
              }
            });
            created++;
          }
        }

        await prisma.pricingSheet.update({ where: { id: sheet.id }, data: { status: 'READY' } });

        res.status(201).json({ sheetId: sheet.id, created, updated, total: itemsData.length });
      } catch (e: unknown) {
        await prisma.pricingSheet.update({ where: { id: sheet.id }, data: { status: 'FAILED' } });
        res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to parse pricing sheet' });
      }
    })
  );


  // ── List sheets ────────────────────────────────────────────────────────────
  router.get('/clients/:clientId/pricing/sheets', wrap(async (req, res) => {
    const clientId = String((req.params as Record<string, string>).clientId);
    const membership = await requireClientMembership(req, res, clientId);
    if (!membership) return;
    const sheets = await prisma.pricingSheet.findMany({ where: { clientId }, orderBy: { createdAt: 'desc' } });
    res.json(sheets);
  }));

  // ── Delete a sheet ─────────────────────────────────────────────────────────
  router.delete('/clients/:clientId/pricing/sheets/:sheetId', wrap(async (req, res) => {
    const clientId = String((req.params as Record<string, string>).clientId);
    const sheetId  = String((req.params as Record<string, string>).sheetId);
    const membership = await requireClientMembership(req, res, clientId);
    if (!membership) return;

    const sheet = await prisma.pricingSheet.findFirst({ where: { id: sheetId, clientId } });
    if (!sheet) { res.status(404).json({ error: 'Sheet not found' }); return; }

    await prisma.$transaction([
      prisma.pricingItem.deleteMany({ where: { pricingSheetId: sheetId } }),
      prisma.pricingSheet.delete({ where: { id: sheetId } })
    ]);
    res.status(204).send();
  }));

  // ── Items for a specific sheet ─────────────────────────────────────────────
  router.get('/clients/:clientId/pricing/sheets/:sheetId/items', wrap(async (req, res) => {
    const clientId = String((req.params as Record<string, string>).clientId);
    const sheetId  = String((req.params as Record<string, string>).sheetId);
    const membership = await requireClientMembership(req, res, clientId);
    if (!membership) return;

    const sheet = await prisma.pricingSheet.findFirst({ where: { id: sheetId, clientId } });
    if (!sheet) { res.status(404).json({ error: 'PricingSheet not found' }); return; }

    const items = await prisma.pricingItem.findMany({
      where: { pricingSheetId: sheetId },
      orderBy: [{ category: 'asc' }, { product: 'asc' }]
    });
    res.json(items);
  }));

  // ── ALL items for a client ─────────────────────────────────────────────────
  router.get('/clients/:clientId/pricing/items', wrap(async (req, res) => {
    const clientId = String((req.params as Record<string, string>).clientId);
    const membership = await requireClientMembership(req, res, clientId);
    if (!membership) return;

    const items = await prisma.pricingItem.findMany({
      where: { clientId },
      orderBy: [{ category: 'asc' }, { product: 'asc' }]
    });
    res.json(items);
  }));

  // ── Create a manual item ───────────────────────────────────────────────────
  router.post('/clients/:clientId/pricing/items', wrap(async (req, res) => {
    const clientId = String((req.params as Record<string, string>).clientId);
    const membership = await requireClientMembership(req, res, clientId);
    if (!membership) return;

    const { category, product, variant, packQuantity, rate, discount } = req.body ?? {};
    if (!category || !product) {
      res.status(400).json({ error: 'category and product are required' });
      return;
    }

    let manualSheet = await prisma.pricingSheet.findFirst({ where: { clientId, title: '__manual__' } });
    if (!manualSheet) {
      manualSheet = await prisma.pricingSheet.create({
        data: { clientId, title: '__manual__', status: 'READY' }
      });
    }

    const item = await prisma.pricingItem.create({
      data: {
        clientId,
        pricingSheetId: manualSheet.id,
        category: String(category).trim(),
        product:  String(product).trim(),
        variant:  variant ? String(variant).trim() : null,
        packQuantity: packQuantity != null ? Number(packQuantity) : null,
        rate:         rate != null ? Number(rate) : null,
        discount:     discount != null && discount !== '' ? Number(discount) : null,
        currency: 'INR'
      }
    });
    res.status(201).json(item);
  }));

  // ── Update one item ────────────────────────────────────────────────────────
  router.patch('/clients/:clientId/pricing/items/:itemId', wrap(async (req, res) => {
    const clientId = String((req.params as Record<string, string>).clientId);
    const itemId   = String((req.params as Record<string, string>).itemId);
    console.log(`[PATCH item] clientId=${clientId} itemId=${itemId} body=`, req.body);

    const membership = await requireClientMembership(req, res, clientId);
    console.log(`[PATCH item] membership=`, membership ? 'ok' : 'DENIED');
    if (!membership) return;

    const existing = await prisma.pricingItem.findFirst({ where: { id: itemId, clientId } });
    console.log(`[PATCH item] existing=`, existing ? 'found' : 'NOT FOUND');
    if (!existing) { res.status(404).json({ error: 'Item not found' }); return; }

    const { category, product, variant, packQuantity, rate, discount } = req.body ?? {};
    const data = {
      ...(category     != null     && { category: String(category).trim() }),
      ...(product      != null     && { product:  String(product).trim()  }),
      ...(variant      !== undefined && { variant: variant ? String(variant).trim() : null }),
      ...(packQuantity !== undefined && {
        packQuantity: packQuantity != null && packQuantity !== '' ? Number(packQuantity) : null
      }),
      ...(rate !== undefined && {
        rate: rate != null && rate !== '' ? Number(rate) : null
      }),
      ...(discount !== undefined && {
        discount: discount != null && discount !== '' ? Number(discount) : null
      })
    };
    console.log(`[PATCH item] update data=`, data);
    const updated = await prisma.pricingItem.update({ where: { id: itemId }, data });
    console.log(`[PATCH item] updated ok`);
    res.json(updated);
  }));


  // ── Delete one item ────────────────────────────────────────────────────────
  router.delete('/clients/:clientId/pricing/items/:itemId', wrap(async (req, res) => {
    const clientId = String((req.params as Record<string, string>).clientId);
    const itemId   = String((req.params as Record<string, string>).itemId);
    const membership = await requireClientMembership(req, res, clientId);
    if (!membership) return;

    const existing = await prisma.pricingItem.findFirst({ where: { id: itemId, clientId } });
    if (!existing) { res.status(404).json({ error: 'Item not found' }); return; }

    await prisma.pricingItem.delete({ where: { id: itemId } });
    res.status(204).send();
  }));

  // ── Delete ALL items ───────────────────────────────────────────────────────
  router.delete('/clients/:clientId/pricing/items', wrap(async (req, res) => {
    const clientId = String((req.params as Record<string, string>).clientId);
    const membership = await requireClientMembership(req, res, clientId);
    if (!membership) return;

    const { count } = await prisma.pricingItem.deleteMany({ where: { clientId } });
    res.json({ deleted: count });
  }));

  // ── Quotation calculator ───────────────────────────────────────────────────
  router.post('/clients/:clientId/pricing/quote', wrap(async (req, res) => {
    const clientId = String((req.params as Record<string, string>).clientId);
    const { items } = req.body ?? {};

    const membership = await requireClientMembership(req, res, clientId);
    if (!membership) return;

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'items array is required' });
      return;
    }

    const ids = items.map((it: { itemId: string }) => String(it.itemId));
    const quantities = new Map<string, number>();
    for (const it of items) {
      const q = Number(it.quantity);
      if (!Number.isFinite(q) || q <= 0) {
        res.status(400).json({ error: 'Each item requires a positive quantity' });
        return;
      }
      quantities.set(String(it.itemId), q);
    }

    const dbItems = await prisma.pricingItem.findMany({ where: { clientId, id: { in: ids } } });
    const lines = dbItems.map((it) => {
      const qty = quantities.get(it.id) ?? 0;
      const rate = it.rate ? Number(it.rate) : 0;
      return {
        itemId: it.id, category: it.category, product: it.product,
        variant: it.variant, packQuantity: it.packQuantity,
        rate, quantity: qty, lineTotal: rate * qty
      };
    });

    const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
    res.json({ currency: 'INR', subtotal, total: subtotal, lines });
  }));
}
