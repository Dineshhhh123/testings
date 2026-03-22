import fs from 'node:fs/promises';
import path from 'node:path';

import mammoth from 'mammoth';
import * as xlsx from 'xlsx';

import { prisma } from '@blink/database/src/client';

const CHUNK_SIZE = 1500; // characters per chunk (simple heuristic for now)

async function readSourceAsText(source: { type: string; filePath: string }) {
  const absPath = path.isAbsolute(source.filePath)
    ? source.filePath
    : path.join(process.cwd(), source.filePath);

  if (source.type === 'TEXT' || source.type === 'CSV' || source.type === 'WEBSITE') {
    const raw = await fs.readFile(absPath, 'utf8');
    return raw;
  }

  if (source.type === 'PDF') {
    const buffer = await fs.readFile(absPath);
    // The installed package is pdf-parse v2+ (e.g. by mehmet-kozan) which exports the PDFParse class
    const { PDFParse } = require('pdf-parse');
    if (!PDFParse) {
      throw new Error(`PDFParse class not found in pdf-parse module exports.`);
    }
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    return result.text || '';
  }

  if (source.type === 'DOCX') {
    const result = await mammoth.extractRawText({ path: absPath });
    return result.value || '';
  }

  if (source.type === 'XLSX') {
    const wb = xlsx.readFile(absPath);
    const parts: string[] = [];
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      if (!sheet) continue;
      const rows = xlsx.utils.sheet_to_json<any[]>(sheet, { header: 1 });
      for (const row of rows) {
        const cells = (row || []).map((c) => (c == null ? '' : String(c))).join(' ');
        if (cells.trim()) {
          parts.push(cells.trim());
        }
      }
    }
    return parts.join('\n');
  }

  throw new Error(`Unsupported source type: ${source.type}`);
}

export async function ingestKnowledgeSource(sourceId: string) {
  const source = await prisma.knowledgeSource.findUnique({
    where: { id: sourceId }
  });

  if (!source) {
    throw new Error('KnowledgeSource not found');
  }

  if (!source.filePath) {
    throw new Error('KnowledgeSource has no filePath');
  }

  const raw = await readSourceAsText({ type: source.type, filePath: source.filePath });
  const text = raw.replace(/\r\n/g, '\n').trim();

  // Clear existing chunks for this source
  await prisma.knowledgeChunk.deleteMany({
    where: { sourceId: source.id }
  });

  const chunks: { index: number; content: string }[] = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    const slice = text.slice(i, i + CHUNK_SIZE).trim();
    if (slice.length) {
      chunks.push({ index: chunks.length, content: slice });
    }
  }

  if (!chunks.length) {
    await prisma.knowledgeSource.update({
      where: { id: sourceId },
      data: {
        status: 'FAILED',
        metadata: {
          ...(source.metadata as any),
          error: 'No content found after reading file'
        }
      }
    });
    throw new Error('No content to ingest');
  }

  await prisma.$transaction([
    prisma.knowledgeChunk.createMany({
      data: chunks.map((c) => ({
        sourceId: source.id,
        clientId: source.clientId,
        chunkIndex: c.index,
        content: c.content
      }))
    }),
    prisma.knowledgeSource.update({
      where: { id: sourceId },
      data: {
        status: 'READY',
        metadata: {
          ...(source.metadata as any),
          ingestedAt: new Date().toISOString(),
          chunkCount: chunks.length
        }
      }
    })
  ]);

  return { chunkCount: chunks.length };
}

