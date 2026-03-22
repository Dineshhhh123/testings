import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

import PDFDocument from 'pdfkit';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';

import { prisma } from '@blink/database/src/client';

const QUOTE_ROOT = path.join(process.cwd(), 'storage', 'quotations');

async function renderDocxTemplateToPdf(
  templatePath: string,
  data: Record<string, any>,
  outputPdfPath: string
) {
  // 1) Fill DOCX template using docxtemplater
  const templateBinary = fs.readFileSync(templatePath, 'binary');
  const zip = new PizZip(templateBinary);
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

  doc.setData(data);

  try {
    doc.render();
  } catch (error: any) {
    // If templating fails, bubble up to fall back to default PDF
    throw new Error(`Failed to render DOCX template: ${error?.message || String(error)}`);
  }

  const filledDocxBuffer = doc.getZip().generate({ type: 'nodebuffer' });

  const filledDocxPath = outputPdfPath.replace(/\.pdf$/i, '.docx');
  fs.writeFileSync(filledDocxPath, filledDocxBuffer);

  // 2) Convert DOCX -> PDF using LibreOffice (soffice) in headless mode
  // Requires LibreOffice CLI (soffice) installed on the host system.
  await new Promise<void>((resolve, reject) => {
    const args = [
      '--headless',
      '--convert-to',
      'pdf',
      '--outdir',
      path.dirname(outputPdfPath),
      filledDocxPath
    ];

    const child = spawn('soffice', args);

    child.on('error', (err) => {
      reject(new Error(`Failed to start soffice for DOCX->PDF: ${err.message}`));
    });

    child.on('exit', (code) => {
      if (code === 0) {
        // LibreOffice will create a PDF with same base name
        // Ensure it exists; if needed, rename to expected outputPdfPath
        const generatedPdfPath =
          outputPdfPath ||
          path.join(
            path.dirname(outputPdfPath),
            `${path.basename(filledDocxPath, path.extname(filledDocxPath))}.pdf`
          );

        if (generatedPdfPath !== outputPdfPath && fs.existsSync(generatedPdfPath)) {
          fs.renameSync(generatedPdfPath, outputPdfPath);
        }

        resolve();
      } else {
        reject(new Error(`soffice exited with code ${code}`));
      }
    });
  });
}

export async function generateQuotationPdfForQuote(quotationId: string) {
  const quotation = await prisma.quotation.findUnique({
    where: { id: quotationId },
    include: {
      client: true,
      lead: true,
      quotationTemplate: true
    }
  });

  if (!quotation) {
    throw new Error('Quotation not found');
  }

  const summary: any = quotation.summary || {};
  const clientName = quotation.client?.name || 'ABC Automations';
  const leadName = quotation.lead?.displayName || quotation.leadId;
  const leadPhone = quotation.lead?.phone || '';

  const clientDir = path.join(QUOTE_ROOT, quotation.clientId);
  fs.mkdirSync(clientDir, { recursive: true });

  const safeLeadName = String(leadName || 'customer').replace(/[^\w\-]+/g, '_');
  const fileName = `quotation-${safeLeadName}-${quotationId}.pdf`;
  const filePath = path.join(clientDir, fileName);

  // Normalized items + grandTotal for both default and template rendering
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

  const templatePath = quotation.quotationTemplate?.filePath || null;

  if (templatePath) {
    const absoluteTemplatePath = path.isAbsolute(templatePath)
      ? templatePath
      : path.join(process.cwd(), templatePath);

    const templateData = {
      company_name: clientName,
      customer_name: leadName,
      customer_phone: leadPhone,
      quotation_id: quotation.id,
      timestamp: new Date().toLocaleString(),
      items,
      grand_total: grandTotal
    };

    try {
      await renderDocxTemplateToPdf(absoluteTemplatePath, templateData, filePath);
      return { filePath, fileName };
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to render DOCX quotation template, falling back to default PDF:', e);
      // Fall through to default PDFKit layout below
    }
  }

  // Fallback/default PDF layout (no template, or template failed)
  const doc = new PDFDocument({ margin: 40 });
  const writeStream = fs.createWriteStream(filePath);
  doc.pipe(writeStream);

  // Header
  doc
    .fontSize(22)
    .text(clientName, { align: 'left' });
  doc
    .fontSize(10)
    .fillColor('#666666')
    .text('Quotation', { align: 'right' })
    .moveDown(0.3);

  doc
    .fontSize(10)
    .fillColor('#000000')
    .text(`Quotation ID: ${quotation.id}`, { align: 'right' });
  doc
    .fontSize(10)
    .text(`Date: ${new Date().toLocaleDateString()}`, { align: 'right' });
  doc.moveDown(1);

  // Customer block
  doc
    .fontSize(11)
    .text('Bill To:', { underline: true });
  doc
    .fontSize(11)
    .text(leadName || 'Customer');
  if (leadPhone) {
    doc.text(`Mobile: ${leadPhone}`);
  }
  doc.moveDown(1);

  // Line items table
  const tableTop = doc.y;
  const colX = {
    item: 40,
    desc: 90,
    packs: 320,
    rate: 380,
    total: 460
  };

  doc
    .fontSize(11)
    .fillColor('#111827')
    .text('Item', colX.item, tableTop)
    .text('Description', colX.desc, tableTop)
    .text('Packs', colX.packs, tableTop, { width: 50, align: 'right' })
    .text('Rate', colX.rate, tableTop, { width: 60, align: 'right' })
    .text('Amount', colX.total, tableTop, { width: 80, align: 'right' });

  const headerBottom = tableTop + 16;
  doc
    .moveTo(colX.item, headerBottom)
    .lineTo(550, headerBottom)
    .strokeColor('#e5e7eb')
    .stroke();

  doc.moveDown(0.5);
  let rowY = headerBottom + 6;

  doc.fontSize(10).fillColor('#111827');

  if (!items.length) {
    doc.text('No line items found for this quotation.', colX.item, rowY);
  } else {
    items.forEach((item, index) => {
      const category = item.category || '';
      const productName = item.productName || '';
      const packQuantity = item.packQuantity;
      const rate = Number(item.rate ?? 0);
      const quantity = Number(item.quantity ?? 0);
      const total = Number(item.total ?? rate * quantity);

      const descParts: string[] = [];
      if (category) descParts.push(category);
      if (productName) descParts.push(productName);
      if (packQuantity) descParts.push(`Pack of ${packQuantity}`);
      const desc = descParts.join(' – ');

      doc.text(String(index + 1), colX.item, rowY);
      doc.text(desc || 'Product', colX.desc, rowY, { width: 210 });
      doc.text(String(quantity), colX.packs, rowY, { width: 50, align: 'right' });
      doc.text(`₹${rate.toFixed(2)}`, colX.rate, rowY, { width: 60, align: 'right' });
      doc.text(`₹${total.toFixed(2)}`, colX.total, rowY, { width: 80, align: 'right' });

      rowY += 18;

      // Avoid writing beyond page; add new page if needed
      if (rowY > doc.page.height - 120) {
        doc.addPage();
        rowY = 80;
      }
    });
  }

  // Totals box
  const totalsTop = Math.max(rowY + 10, tableTop + 60);
  doc
    .moveTo(colX.rate, totalsTop)
    .lineTo(550, totalsTop)
    .strokeColor('#e5e7eb')
    .stroke();

  doc
    .fontSize(11)
    .fillColor('#111827')
    .text('Grand Total:', colX.rate, totalsTop + 6, { width: 60, align: 'right' })
    .font('Helvetica-Bold')
    .text(`₹${grandTotal.toFixed(2)}`, colX.total, totalsTop + 6, {
      width: 80,
      align: 'right'
    })
    .font('Helvetica');

  // Footer / notes
  doc.moveDown(3);
  doc
    .fontSize(9)
    .fillColor('#6b7280')
    .text(
      'Thank you for your business. If you have any questions about this quotation, please reply on WhatsApp or contact us using your usual channel.',
      { align: 'left' }
    );

  doc.end();

  await new Promise<void>((resolve, reject) => {
    writeStream.on('finish', () => resolve());
    writeStream.on('error', (err) => reject(err));
  });

  return { filePath, fileName };
}

