const express = require('express');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const PDFDocument = require('pdfkit');
const qrcode = require('qrcode-terminal');
const xlsx = require('xlsx');

// 1) Open or create local SQLite DB
const dbPath = path.join(__dirname, 'bot.sqlite');
const db = new Database(dbPath);
const quotationsDir = path.join(__dirname, 'quotations');
const EVOLUTION_API_BASE_URL = process.env.EVOLUTION_API_BASE_URL || 'http://localhost:8080';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || 'change-me-evolution-local';
const EVOLUTION_INSTANCE_NAME = process.env.EVOLUTION_INSTANCE_NAME || 'abc-printing-press';
const BOT_WEBHOOK_PORT = Number(process.env.BOT_WEBHOOK_PORT || 3001);
const BOT_BASE_URL = process.env.BOT_BASE_URL || `http://localhost:${BOT_WEBHOOK_PORT}`;
const processedMessageIds = new Map();
const PROCESSED_MESSAGE_TTL_MS = 10 * 60 * 1000;
if (!fs.existsSync(quotationsDir)) {
  fs.mkdirSync(quotationsDir, { recursive: true });
}

// 2) Create tables if not exist
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT UNIQUE,
  name TEXT,
  state TEXT,
  has_quotation INTEGER DEFAULT 0,
  is_blocked INTEGER DEFAULT 0,
  chat_history TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  phone TEXT,
  name TEXT,
  scheduled_at TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// 3) Load products from categorized_products.xlsx
const productsFile = path.join(__dirname, 'categorized_products.xlsx');
const workbook = xlsx.readFile(productsFile);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const productRows = xlsx.utils.sheet_to_json(sheet); 
// Expect columns like: Category, Product, Pack Quantity, Rate

function getRowValue(row, preferredKeys = [], matcher = null) {
  for (const key of preferredKeys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
      return row[key];
    }
  }

  if (matcher) {
    for (const key of Object.keys(row)) {
      if (matcher(String(key))) {
        const value = row[key];
        if (value !== undefined && value !== null && String(value).trim() !== '') {
          return value;
        }
      }
    }
  }

  return null;
}

function toNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeCustomerName(value) {
  const raw = String(value || '').replace(/\s+/g, ' ').trim();
  if (!raw) return null;

  // Avoid storing obviously bad values as the customer's name.
  if (raw.length > 60) return null;
  if (/https?:\/\//i.test(raw)) return null;
  if (/AIza|sk-[a-z0-9]/i.test(raw)) return null;

  const lettersOnly = raw.replace(/[^a-z ]/gi, '');
  if (lettersOnly.trim().length < 2) return null;

  return raw;
}

function cleanProductName(product, packQuantity) {
  const text = String(product || '').trim();
  if (!text) return text;

  const match = text.match(/\((\d+)\)\s*$/);
  if (!match) return text;

  const trailingPack = Number(match[1]);
  if (packQuantity && trailingPack === Number(packQuantity)) {
    return text.replace(/\s*\(\d+\)\s*$/, '').trim();
  }

  return text;
}

// Build helper structures
const productsByCategory = {};
const categoryNames = [];
for (const row of productRows) {
  const rawProduct = String(getRowValue(row, ['Product', 'product'], (key) => /^product$/i.test(key)) || '').trim();
  const category = String(getRowValue(row, ['Category', 'category'], (key) => /^category$/i.test(key)) || '').trim();
  const packQuantity = toNumberOrNull(
    getRowValue(
      row,
      ['Pack Quantity', 'PackQuantity', 'pack_quantity', 'packQty', 'Pack'],
      (key) => /^pack/i.test(key),
    ),
  );
  const rate = toNumberOrNull(getRowValue(row, ['Rate', 'rate'], (key) => /^rate$/i.test(key)));
  const product = cleanProductName(rawProduct, packQuantity);

  if (!product || !category) continue;
  if (!productsByCategory[category]) {
    productsByCategory[category] = [];
    categoryNames.push(category);
  }
  productsByCategory[category].push({
    product,
    rawProduct,
    packQuantity,
    rate,
  });
}

function getUserByPhone(phone) {
  const normalizedPhone = String(phone || '').replace(/\D+/g, '');
  const exactStmt = db.prepare('SELECT * FROM users WHERE phone = ?');
  const existing = exactStmt.get(phone) || exactStmt.get(normalizedPhone);
  if (existing) {
    return existing;
  }

  const legacyStmt = db.prepare(`
    SELECT *
    FROM users
    WHERE replace(replace(replace(phone, '@c.us', ''), '@s.whatsapp.net', ''), '@lid', '') = ?
    LIMIT 1
  `);
  return legacyStmt.get(normalizedPhone);
}

function createUser(phone) {
  const storedPhone = String(phone || '').trim();
  const stmt = db.prepare(`
    INSERT INTO users (phone, name, state, has_quotation, is_blocked, chat_history)
    VALUES (?, NULL, 'awaiting_name', 0, 0, '{}')
  `);
  const info = stmt.run(storedPhone);
  return {
    id: info.lastInsertRowid,
    phone: storedPhone,
    name: null,
    state: 'awaiting_name',
    has_quotation: 0,
    is_blocked: 0,
    chat_history: '{}',
  };
}

function updateUser(user) {
  const stmt = db.prepare(`
    UPDATE users
    SET name = ?, state = ?, has_quotation = ?, is_blocked = ?, chat_history = ?, updated_at = datetime('now')
    WHERE phone = ?
  `);
  stmt.run(
    user.name,
    user.state,
    user.has_quotation,
    user.is_blocked,
    user.chat_history,
    user.phone
  );
}

function insertMeeting(userId, phone, name, scheduledAt, notes) {
  const stmt = db.prepare(`
    INSERT INTO meetings (user_id, phone, name, scheduled_at, notes, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `);
  stmt.run(userId || null, phone || '', name || '', scheduledAt || '', notes || '');
}

function formatDisplayPhone(value = '') {
  return normalizePhoneNumber(value) || String(value || '');
}

function getSessionData(user) {
  try {
    const parsed = JSON.parse(user.chat_history || '{}');

    if (Array.isArray(parsed)) {
      return {
        messages: parsed,
        selectedCategory: null,
        selectedProductName: null,
        selectedProducts: [],
        quantities: {},
        quotationSummary: null,
        meetingRequested: false,
      };
    }

    return {
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      selectedCategory: parsed.selectedCategory || null,
      selectedProductName: parsed.selectedProductName || null,
      selectedProducts: Array.isArray(parsed.selectedProducts) ? parsed.selectedProducts : [],
      quantities: typeof parsed.quantities === 'object' && parsed.quantities !== null ? parsed.quantities : {},
      quotationSummary: parsed.quotationSummary || null,
      meetingRequested: !!parsed.meetingRequested,
    };
  } catch {
    return {
      messages: [],
      selectedCategory: null,
      selectedProductName: null,
      selectedProducts: [],
      quantities: {},
      quotationSummary: null,
      meetingRequested: false,
    };
  }
}

function saveSessionData(user, sessionData) {
  user.chat_history = JSON.stringify({
    messages: Array.isArray(sessionData.messages) ? sessionData.messages : [],
    selectedCategory: sessionData.selectedCategory || null,
    selectedProductName: sessionData.selectedProductName || null,
    selectedProducts: Array.isArray(sessionData.selectedProducts) ? sessionData.selectedProducts : [],
    quantities: sessionData.quantities || {},
    quotationSummary: sessionData.quotationSummary || null,
    meetingRequested: !!sessionData.meetingRequested,
  });
}

function parseSelectionIndexes(text, maxLength) {
  const matches = text.match(/\d+/g) || [];
  const indexes = matches
    .map((value) => Number.parseInt(value, 10) - 1)
    .filter((index) => Number.isInteger(index) && index >= 0 && index < maxLength);

  return [...new Set(indexes)];
}

function findCategoryByText(text) {
  const normalizedInput = normalizeText(text);
  return categoryNames.find((category) => normalizeText(category) === normalizedInput) || null;
}

function findProductsByText(text, products) {
  const normalizedInput = normalizeText(text);
  if (!normalizedInput) {
    return [];
  }

  return products.filter((item) => normalizedInput.includes(normalizeText(item.product)));
}

function parsePackCounts(text, selectedProducts) {
  const packCounts = {};
  const pairMatches = [...text.matchAll(/(\d+)\s*[:=-]\s*(\d+)/g)];

  if (pairMatches.length > 0) {
    for (const match of pairMatches) {
      const itemIndex = Number.parseInt(match[1], 10) - 1;
      const packCount = Number.parseInt(match[2], 10);

      if (selectedProducts[itemIndex] && Number.isFinite(packCount) && packCount > 0) {
        packCounts[selectedProducts[itemIndex].product] = packCount;
      }
    }

    return Object.keys(packCounts).length ? packCounts : null;
  }

  const numbers = (text.match(/\d+/g) || []).map((value) => Number.parseInt(value, 10));
  if (selectedProducts.length === 1 && numbers.length >= 1) {
    packCounts[selectedProducts[0].product] = numbers[0];
    return packCounts;
  }

  if (numbers.length === selectedProducts.length && selectedProducts.length > 0) {
    selectedProducts.forEach((item, index) => {
      packCounts[item.product] = numbers[index];
    });
    return packCounts;
  }

  return null;
}

function buildQuotationSummary(selectedCategory, selectedProducts, packCounts) {
  const items = selectedProducts.map((item) => {
    const requestedPacks = Number(packCounts[item.product] || 0);
    const packQuantity = item.packQuantity || 0;
    const rate = item.rate || 0;
    const totalUnits = requestedPacks * packQuantity;
    const lineTotal = requestedPacks * rate;

    return {
      category: selectedCategory,
      product: item.product,
      requestedPacks,
      totalUnits,
      packQuantity,
      rate,
      lineTotal,
    };
  });

  const grandTotal = items.reduce((sum, item) => sum + item.lineTotal, 0);

  return {
    items,
    grandTotal,
  };
}

function formatCurrency(value) {
  return `Rs. ${Number(value || 0).toFixed(2)}`;
}

function sanitizeFilePart(value) {
  return String(value || 'quotation')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 40) || 'quotation';
}

function generateQuotationPdf(user, sessionData) {
  return new Promise((resolve, reject) => {
    const summary = sessionData.quotationSummary;
    if (!summary || !Array.isArray(summary.items) || summary.items.length === 0) {
      reject(new Error('Quotation summary is missing.'));
      return;
    }

    const timestamp = Date.now();
    const customerName = user.name || 'customer';
    const fileName = `quotation-${sanitizeFilePart(customerName)}-${timestamp}.pdf`;
    const filePath = path.join(quotationsDir, fileName);
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const stream = fs.createWriteStream(filePath);

    doc.pipe(stream);

    doc.fontSize(20).text('ABC Printing Press', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(12).text('Quotation', { align: 'center' });
    doc.moveDown();

    doc.fontSize(10);
    doc.text(`Customer: ${customerName}`);
    doc.text(`Phone: ${formatDisplayPhone(user.phone)}`);
    doc.text(`Date: ${new Date(timestamp).toLocaleString()}`);
    doc.text(`Category: ${sessionData.selectedCategory || 'N/A'}`);
    doc.moveDown();

    const startX = 40;
    const rowHeight = 22;
    let y = doc.y;
    const columns = {
      product: startX,
      packs: 255,
      packSize: 315,
      rate: 385,
      units: 455,
      total: 515,
    };

    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('Product', columns.product, y, { width: 200 });
    doc.text('Packs', columns.packs, y, { width: 50, align: 'right' });
    doc.text('Pack Size', columns.packSize, y, { width: 55, align: 'right' });
    doc.text('Rate', columns.rate, y, { width: 60, align: 'right' });
    doc.text('Units', columns.units, y, { width: 50, align: 'right' });
    doc.text('Total', columns.total, y, { width: 55, align: 'right' });
    y += rowHeight;
    doc.moveTo(startX, y - 6).lineTo(555, y - 6).stroke();

    doc.font('Helvetica');
    for (const item of summary.items) {
      if (y > 730) {
        doc.addPage();
        y = 40;
      }

      doc.text(item.product, columns.product, y, { width: 200 });
      doc.text(String(item.requestedPacks), columns.packs, y, { width: 50, align: 'right' });
      doc.text(String(item.packQuantity), columns.packSize, y, { width: 55, align: 'right' });
      doc.text(formatCurrency(item.rate), columns.rate, y, { width: 60, align: 'right' });
      doc.text(String(item.totalUnits), columns.units, y, { width: 50, align: 'right' });
      doc.text(formatCurrency(item.lineTotal), columns.total, y, { width: 55, align: 'right' });
      y += rowHeight;
    }

    doc.moveTo(startX, y - 6).lineTo(555, y - 6).stroke();
    doc.moveDown();
    doc.font('Helvetica-Bold');
    doc.text(`Grand Total: ${formatCurrency(summary.grandTotal)}`, 0, y + 8, {
      align: 'right',
    });
    doc.moveDown(2);
    doc.font('Helvetica').fontSize(10).text('Thank you for choosing ABC Printing Press.', {
      align: 'center',
    });

    doc.end();

    stream.on('finish', () => resolve({ fileName, filePath }));
    stream.on('error', reject);
  });
}

async function getAiReplyFromN8n(user, messageText, context) {
  const res = await fetch('http://localhost:5678/webhook/ai/whatsapp-reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user: {
        phone: user.phone,
        name: user.name,
        state: user.state,
        hasQuotation: !!user.has_quotation,
        isBlocked: !!user.is_blocked,
      },
      message: messageText,
      context, // will define shortly
    }),
  });

  const rawBody = await res.text();
  if (!res.ok) {
    console.error('n8n AI webhook error:', res.status, rawBody);
    return 'Sorry, something went wrong.';
  }

  let data = {};
  try {
    data = JSON.parse(rawBody);
  } catch {
    console.error('Invalid JSON returned from n8n webhook:', rawBody);
  }

  return data.reply || 'Sorry, something went wrong.';
}

function extractMessageText(message = {}) {
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    ''
  );
}

function normalizePhoneNumber(remoteJid = '') {
  const value = String(remoteJid).split('@')[0] || '';
  return value.replace(/\D+/g, '');
}

function isIncomingMessagePayload(payload = {}) {
  const status = String(payload.data?.status || '').toUpperCase();
  return (
    String(payload.event || '').toLowerCase() === 'messages.upsert' &&
    payload.data &&
    payload.data.key &&
    payload.data.key.fromMe === false &&
    (status === '' || status === 'DELIVERY_ACK')
  );
}

function getIncomingPayloadDetails(payload = {}) {
  const remoteJid = payload.data?.key?.remoteJid || '';
  const senderJid = payload.sender || payload.data?.sender || '';
  const phone = remoteJid;
  return {
    phone,
    text: String(extractMessageText(payload.data?.message || '') || '').trim(),
    remoteJid,
    senderJid,
    replyTarget: remoteJid,
    messageId: String(payload.data?.key?.id || ''),
  };
}

function pruneProcessedMessageIds() {
  const cutoff = Date.now() - PROCESSED_MESSAGE_TTL_MS;
  for (const [key, createdAt] of processedMessageIds.entries()) {
    if (createdAt < cutoff) {
      processedMessageIds.delete(key);
    }
  }
}

async function evolutionRequest(endpoint, body, method = 'POST') {
  const res = await fetch(`${EVOLUTION_API_BASE_URL}${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      apikey: EVOLUTION_API_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const raw = await res.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { raw };
  }

  if (!res.ok) {
    throw new Error(`Evolution API request failed (${res.status}): ${raw}`);
  }

  return data;
}

async function sendTextViaEvolution(number, text) {
  return evolutionRequest(`/message/sendText/${EVOLUTION_INSTANCE_NAME}`, {
    number,
    text,
    delay: 500,
    linkPreview: false,
  });
}

async function sendPdfViaEvolution(number, filePath, fileName) {
  const pdfBase64 = fs.readFileSync(filePath, { encoding: 'base64' });
  return evolutionRequest(`/message/sendMedia/${EVOLUTION_INSTANCE_NAME}`, {
    number,
    mediatype: 'document',
    mimetype: 'application/pdf',
    caption: 'Please find your quotation attached.',
    media: pdfBase64,
    fileName,
    delay: 500,
  });
}

async function createEvolutionInstanceIfNeeded() {
  try {
    await evolutionRequest('/instance/create', {
      instanceName: EVOLUTION_INSTANCE_NAME,
      qrcode: false,
      integration: 'WHATSAPP-BAILEYS',
      rejectCall: false,
      groupsIgnore: true,
      alwaysOnline: true,
      readMessages: false,
      readStatus: false,
      syncFullHistory: false,
      webhook: {
        url: `${BOT_BASE_URL}/evolution/webhook`,
        byEvents: false,
        base64: false,
        events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'CALL'],
      },
    });
  } catch (err) {
    const message = String(err.message || err);
    if (!message.includes('already in use')) {
      throw err;
    }
  }

  await evolutionRequest(`/webhook/set/${EVOLUTION_INSTANCE_NAME}`, {
    webhook: {
      enabled: true,
      url: `${BOT_BASE_URL}/evolution/webhook`,
      byEvents: false,
      base64: false,
      events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'CALL'],
    },
  });
}

async function printEvolutionConnectionInstructions() {
  try {
    const result = await evolutionRequest(`/instance/connect/${EVOLUTION_INSTANCE_NAME}`, null, 'GET');
    if (result?.pairingCode) {
      console.log(`Evolution pairing code for ${EVOLUTION_INSTANCE_NAME}: ${result.pairingCode}`);
    }
    if (result?.code && !String(result.code).includes('data:image')) {
      qrcode.generate(String(result.code), { small: true });
    }
    console.log(`Open Evolution API manager at ${EVOLUTION_API_BASE_URL} and connect instance "${EVOLUTION_INSTANCE_NAME}".`);
  } catch (err) {
    console.error('Unable to fetch Evolution connection details:', err.message || err);
  }
}

async function handleIncomingMessage(phone, text, replyTarget) {
  // 1) Get or create user
  let user = getUserByPhone(phone);
  if (!user) {
    user = createUser(phone);
  }

  const sessionData = getSessionData(user);
  sessionData.messages.push({
    role: 'user',
    text,
    at: new Date().toISOString(),
  });
  sessionData.selectedCategory = sessionData.selectedCategory || null;
  sessionData.selectedProducts = Array.isArray(sessionData.selectedProducts) ? sessionData.selectedProducts : [];
  sessionData.quantities = sessionData.quantities || {};
  sessionData.quotationSummary = sessionData.quotationSummary || null;
  sessionData.meetingRequested = !!sessionData.meetingRequested;

  // 2) Block / quotation checks
  if (user.is_blocked) {
    return;
  }
  if (user.has_quotation) {
    return;
  }

  // 2b) Meeting scheduling: if they previously asked to schedule, this message is their date/time
  let stepOverride = null;
  if (sessionData.meetingRequested) {
    insertMeeting(user.id, user.phone, user.name, text, JSON.stringify({ lastMessages: sessionData.messages.slice(-4).map((m) => m.text) }));
    sessionData.meetingRequested = false;
    stepOverride = 'meeting_confirmed';
  } else if (/\b(schedule|call|meeting|meet)\b/i.test(text)) {
    sessionData.meetingRequested = true;
    stepOverride = 'ask_meeting_datetime';
  }

  // 3) Update user state BEFORE calling n8n
  const isGreeting = /^(hi|hello|hey)$/i.test(text);
  const wantsBack = /\b(back|change|edit|restart)\b/i.test(text);
  const wantsMore = /\bmore\b/i.test(text);

  if ((wantsBack || wantsMore) && !stepOverride) {
    if (user.state === 'awaiting_product_choice') {
      sessionData.selectedCategory = null;
      sessionData.selectedProducts = [];
      sessionData.quantities = {};
      sessionData.quotationSummary = null;
      user.state = 'awaiting_category_choice';
    } else if (user.state === 'awaiting_quantity') {
      sessionData.selectedProducts = [];
      sessionData.quantities = {};
      sessionData.quotationSummary = null;
      user.state = 'awaiting_product_choice';
    } else if (user.state === 'awaiting_confirmation') {
      sessionData.quantities = {};
      sessionData.quotationSummary = null;
      user.state = 'awaiting_quantity';
    }
  }

  if (user.state === 'awaiting_name') {
    if (!isGreeting && text.length > 0) {
      const candidateName = normalizeCustomerName(text);
      if (candidateName) {
        user.name = user.name || candidateName;
        user.state = 'awaiting_category_choice';
      }
    }
  } else if (user.state === 'awaiting_category_choice') {
    const categoryIndexes = parseSelectionIndexes(text, categoryNames.length);
    const selectedCategory =
      categoryIndexes.length > 0
        ? categoryNames[categoryIndexes[0]]
        : findCategoryByText(text);

    if (selectedCategory) {
      sessionData.selectedCategory = selectedCategory;
      sessionData.selectedProducts = [];
      sessionData.selectedProductName = null;
      sessionData.quantities = {};
      sessionData.quotationSummary = null;
      user.state = 'awaiting_product_choice';
    }
  } else if (user.state === 'awaiting_product_choice') {
    const productsForCategory = productsByCategory[sessionData.selectedCategory] || [];
    const selectionIndexes = parseSelectionIndexes(text, productsForCategory.length);

    let selectedProducts = selectionIndexes.map((index) => productsForCategory[index]);
    if (!selectedProducts.length) {
      selectedProducts = findProductsByText(text, productsForCategory);
    }

    if (selectedProducts.length) {
      sessionData.selectedProducts = selectedProducts;
      sessionData.selectedProductName = selectedProducts[0].product;
      sessionData.quantities = {};
      sessionData.quotationSummary = null;
      user.state = 'awaiting_quantity';
    }
  } else if (user.state === 'awaiting_quantity') {
    const parsedPackCounts = parsePackCounts(text, sessionData.selectedProducts);
    if (parsedPackCounts) {
      sessionData.quantities = parsedPackCounts;
      sessionData.quotationSummary = buildQuotationSummary(
        sessionData.selectedCategory,
        sessionData.selectedProducts,
        parsedPackCounts,
      );
      user.state = 'awaiting_confirmation';
    }
  } else if (user.state === 'awaiting_confirmation') {
    if (/\b(yes|confirm|ok|okay|y)\b/i.test(text)) {
      user.has_quotation = 1;
      user.state = 'completed';
    } else if (/\b(no|change|edit|back)\b/i.test(text)) {
      user.state = 'awaiting_product_choice';
      sessionData.selectedProducts = [];
      sessionData.selectedProductName = null;
      sessionData.quantities = {};
      sessionData.quotationSummary = null;
    }
  } else if (user.state === 'completed') {
    return;
  }

  if (!sessionData.selectedProductName && sessionData.selectedProducts.length === 1) {
    sessionData.selectedProductName = sessionData.selectedProducts[0].product;
  }

  // 4) Decide high-level step and build context for n8n
  let step = 'greet_or_name';
  const categoryMenu = categoryNames.map((category, index) => `${index + 1}. ${category}`);
  const productsForSelectedCategory = productsByCategory[sessionData.selectedCategory] || [];
  const productMenu = productsForSelectedCategory.map((item, index) => `${index + 1}. ${item.product}`);

  if (stepOverride) {
    step = stepOverride;
  } else if (user.state === 'awaiting_name') {
    step = 'greet_or_name';
  } else if (user.state === 'awaiting_category_choice') {
    step = 'choose_category';
  } else if (user.state === 'awaiting_product_choice') {
    step = 'choose_product';
  } else if (user.state === 'awaiting_quantity') {
    step = 'ask_quantity';
  } else if (user.state === 'awaiting_confirmation') {
    step = 'summary_and_confirm';
  } else if (user.state === 'completed') {
    step = 'quotation_confirmed';
  } else {
    step = 'free_chat';
  }

  const categoryMenuFullText = categoryMenu.length ? categoryMenu.join('\n') : '';
  const productMenuFullText = productMenu.length ? productMenu.join('\n') : '';
  const selectedProductsListText = (sessionData.selectedProducts || [])
    .map((item, index) => `${index + 1}. ${item.product} - ${item.packQuantity} per pack - rate ${formatCurrency(item.rate)} per pack`)
    .join('\n');
  let summaryFullText = '';
  if (sessionData.quotationSummary && sessionData.quotationSummary.items) {
    summaryFullText = sessionData.quotationSummary.items
      .map((item, i) => `${i + 1}. ${item.product} | packs ${item.requestedPacks} | pack size ${item.packQuantity} | rate ₹${item.rate} | units ${item.totalUnits} | total ₹${item.lineTotal}`)
      .join('\n');
    summaryFullText += `\nGrand total: ₹${sessionData.quotationSummary.grandTotal || 0}`;
  }

  const context = {
    step,
    workflowState: user.state,
    categoryMenu,
    categoryMenuFullText,
    selectedCategory: sessionData.selectedCategory,
    productMenu,
    productMenuFullText,
    selectedProductName: sessionData.selectedProductName,
    selectedProducts: sessionData.selectedProducts,
    selectedProductsListText,
    quantities: sessionData.quantities,
    quotationSummary: sessionData.quotationSummary,
    summaryFullText,
  };

  // 5) Ask n8n/Gemini for a nice reply
  const reply = await getAiReplyFromN8n(user, text, context);

  sessionData.messages.push({
    role: 'assistant',
    text: reply,
    at: new Date().toISOString(),
  });
  saveSessionData(user, sessionData);
  updateUser(user);

  // 6) Send reply via WhatsApp through Evolution API
  if (reply && reply.trim()) {
    await sendTextViaEvolution(replyTarget, reply);
  }

  if (step === 'quotation_confirmed' && sessionData.quotationSummary) {
    try {
      const { fileName, filePath } = await generateQuotationPdf(user, sessionData);
      const sendResult = await sendPdfViaEvolution(replyTarget, filePath, fileName);
      console.log('Quotation PDF sent successfully:', sendResult?.key?.id || sendResult);
    } catch (pdfError) {
      console.error('Error generating or sending quotation PDF:', pdfError);
      await sendTextViaEvolution(
        replyTarget,
        'Your quotation is confirmed. We had trouble attaching the PDF right now, but our team will share it shortly.',
      );
    }
  }
}

async function bootstrap() {
  await createEvolutionInstanceIfNeeded();

  const app = express();
  app.use(express.json({ limit: '25mb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/evolution/webhook', async (req, res) => {
    try {
      const payload = req.body || {};

      if (!isIncomingMessagePayload(payload)) {
        res.status(200).json({ ignored: true });
        return;
      }

      const { phone, text, remoteJid, senderJid, replyTarget, messageId } = getIncomingPayloadDetails(payload);
      const isGroupMessage = String(remoteJid).endsWith('@g.us');
      const isDirectMessage = [remoteJid, senderJid].some((jid) =>
        /@(s\.whatsapp\.net|c\.us|lid)$/i.test(String(jid || '')),
      );
      const processedKey = `${remoteJid}:${messageId}`;

      if (!phone || !text || !messageId || isGroupMessage || !isDirectMessage) {
        res.status(200).json({ ignored: true });
        return;
      }

      pruneProcessedMessageIds();
      if (processedMessageIds.has(processedKey)) {
        res.status(200).json({ duplicate: true });
        return;
      }

      processedMessageIds.set(processedKey, Date.now());

      await handleIncomingMessage(phone, text, replyTarget);
      res.status(200).json({ processed: true });
    } catch (err) {
      console.error('Evolution webhook error:', err);
      res.status(500).json({ processed: false });
    }
  });

  app.listen(BOT_WEBHOOK_PORT, async () => {
    console.log(`Bot webhook server listening on ${BOT_BASE_URL}`);
    console.log(`Evolution API base URL: ${EVOLUTION_API_BASE_URL}`);
    console.log(`Evolution instance: ${EVOLUTION_INSTANCE_NAME}`);
    await printEvolutionConnectionInstructions();
  });
}

bootstrap().catch((err) => {
  console.error('Error starting Evolution bot:', err);
});