import type { Request, Response, Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';

import multer from 'multer';

import { prisma } from '@blink/database/src/client';
import { requireClientMembership } from '../clients/guard';
import { ingestKnowledgeSource } from './ingest';

const uploadRoot = path.join(process.cwd(), 'storage', 'uploads', 'clients');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const clientId = String(req.params.clientId || 'unknown');
    const dir = path.join(uploadRoot, clientId, 'knowledge');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/[^\w.\-]+/g, '_');
    const stamped = `${Date.now()}-${safeName}`;
    cb(null, stamped);
  }
});

const upload = multer({ storage });

function inferSourceType(mime: string, originalName: string): 'PDF' | 'DOCX' | 'XLSX' | 'CSV' | 'TEXT' {
  const name = originalName.toLowerCase();
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'PDF';
  if (mime.includes('word') || name.endsWith('.docx')) return 'DOCX';
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return 'XLSX';
  if (name.endsWith('.csv')) return 'CSV';
  return 'TEXT';
}

export function registerKnowledgeRoutes(router: Router) {
  // Simple upload endpoint for knowledge sources (files)
  router.post(
    '/clients/:clientId/knowledge/upload',
    upload.single('file'),
    async (req: Request, res: Response) => {
      const { clientId } = req.params;
      const file = req.file;

       const membership = await requireClientMembership(req, res, clientId);
       if (!membership) return;

      if (!file) {
        res.status(400).json({ error: 'file is required' });
        return;
      }

      const client = await prisma.client.findUnique({ where: { id: clientId } });
      if (!client) {
        res.status(404).json({ error: 'Client not found' });
        return;
      }

      const type = inferSourceType(file.mimetype, file.originalname);

      const source = await prisma.knowledgeSource.create({
        data: {
          clientId,
          type,
          title: file.originalname,
          filePath: path.relative(process.cwd(), file.path),
          mimeType: file.mimetype,
          status: 'PENDING',
          metadata: {
            size: file.size,
            originalName: file.originalname
          }
        }
      });

      res.status(201).json(source);
    }
  );

  // Create a knowledge source from a plain text payload (manual note)
  router.post('/clients/:clientId/knowledge/text', async (req: Request, res: Response) => {
    const { clientId } = req.params;
    const { title, content } = req.body ?? {};

    const membership = await requireClientMembership(req, res, clientId);
    if (!membership) return;

    if (typeof content !== 'string' || !content.trim()) {
      res.status(400).json({ error: 'content is required' });
      return;
    }

    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    const dir = path.join(uploadRoot, clientId, 'knowledge');
    fs.mkdirSync(dir, { recursive: true });
    const safeTitle = (title && String(title).trim()) || 'Manual note';
    const fileName = `${Date.now()}-manual-note.txt`;
    const filePath = path.join(dir, fileName);
    fs.writeFileSync(filePath, content, 'utf8');

    const source = await prisma.knowledgeSource.create({
      data: {
        clientId,
        type: 'TEXT',
        title: safeTitle,
        filePath: path.relative(process.cwd(), filePath),
        mimeType: 'text/plain',
        status: 'PENDING',
        metadata: {
          originalName: fileName,
          source: 'manual-text'
        }
      }
    });

    res.status(201).json(source);
  });

  // Create a knowledge source from a website URL
  router.post('/clients/:clientId/knowledge/url', async (req: Request, res: Response) => {
    const { clientId } = req.params;
    const { url, title } = req.body ?? {};

    const membership = await requireClientMembership(req, res, clientId);
    if (!membership) return;

    if (typeof url !== 'string' || !url.trim()) {
      res.status(400).json({ error: 'url is required' });
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(url.trim());
    } catch {
      res.status(400).json({ error: 'url is not a valid URL' });
      return;
    }

    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    try {
      const response = await fetch(parsed.toString());
      if (!response.ok) {
        const text = await response.text();
        res
          .status(502)
          .json({ error: 'Failed to fetch website content', details: text.slice(0, 500) });
        return;
      }
      const html = await response.text();

      // Very simple HTML -> text extraction
      const withoutScripts = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ');
      const text = withoutScripts.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

      if (!text) {
        res.status(400).json({ error: 'No text content found at URL' });
        return;
      }

      const dir = path.join(uploadRoot, clientId, 'knowledge');
      fs.mkdirSync(dir, { recursive: true });
      const hostname = parsed.hostname.replace(/[^\w.\-]+/g, '_');
      const fileName = `${Date.now()}-${hostname}.txt`;
      const filePath = path.join(dir, fileName);
      fs.writeFileSync(filePath, text, 'utf8');

      const source = await prisma.knowledgeSource.create({
        data: {
          clientId,
          type: 'WEBSITE',
          title: (title && String(title).trim()) || parsed.hostname,
          filePath: path.relative(process.cwd(), filePath),
          mimeType: 'text/plain',
          status: 'PENDING',
          metadata: {
            originalUrl: parsed.toString(),
            originalName: fileName,
            source: 'website'
          }
        }
      });

      res.status(201).json(source);
    } catch (e: any) {
      res
        .status(500)
        .json({ error: e?.message ?? 'Failed to fetch or save website content for RAG' });
    }
  });

  // List knowledge sources for a client
  router.get('/clients/:clientId/knowledge', async (req: Request, res: Response) => {
    const { clientId } = req.params;
    const membership = await requireClientMembership(req, res, clientId);
    if (!membership) return;
    const sources = await prisma.knowledgeSource.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' }
    });
    res.json(sources);
  });

  // Trigger ingestion for a single source (dev-friendly endpoint for now)
  router.post('/clients/:clientId/knowledge/:sourceId/ingest', async (req: Request, res: Response) => {
    const { clientId, sourceId } = req.params;

    const membership = await requireClientMembership(req, res, clientId);
    if (!membership) return;

    const source = await prisma.knowledgeSource.findUnique({
      where: { id: sourceId }
    });

    if (!source || source.clientId !== clientId) {
      res.status(404).json({ error: 'KnowledgeSource not found for this client' });
      return;
    }

    try {
      const result = await ingestKnowledgeSource(sourceId);
      res.status(200).json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? 'Ingestion failed' });
    }
  });

  // Delete a knowledge source
  router.delete('/clients/:clientId/knowledge/:sourceId', async (req: Request, res: Response) => {
    const { clientId, sourceId } = req.params;

    const membership = await requireClientMembership(req, res, clientId);
    if (!membership) return;

    const source = await prisma.knowledgeSource.findUnique({
      where: { id: sourceId }
    });

    if (!source || source.clientId !== clientId) {
      res.status(404).json({ error: 'KnowledgeSource not found for this client' });
      return;
    }

    // Best-effort file removal
    if (source.filePath) {
      try {
        const abs = path.isAbsolute(source.filePath)
          ? source.filePath
          : path.join(process.cwd(), source.filePath);
        if (fs.existsSync(abs)) {
          fs.unlinkSync(abs);
        }
      } catch {
        // ignore file errors
      }
    }

    await prisma.knowledgeChunk.deleteMany({ where: { sourceId } });
    await prisma.knowledgeSource.delete({ where: { id: sourceId } });

    res.status(204).end();
  });
}

