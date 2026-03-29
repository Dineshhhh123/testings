import cors from 'cors';
import express from 'express';
import { Router } from 'express';
import path from 'node:path';

import { registerAuthRoutes } from './modules/auth/routes';
import { requireAuth } from './modules/auth/middleware';
import { registerClientRoutes } from './modules/clients/routes';
import { registerWhatsappRoutes } from './modules/whatsapp/routes';
import { registerWhatsappWebhookRoutes } from './modules/whatsapp/webhookRoutes';
import { registerKnowledgeRoutes } from './modules/knowledge/routes';
import { registerRagRoutes } from './modules/rag/routes';
import { registerLeadRoutes } from './modules/leads/routes';
import { registerConversationRoutes } from './modules/conversations/routes';
import { registerPricingRoutes } from './modules/pricing/routes';
import { registerQuotationRoutes } from './modules/quotations/routes';
import { registerBlocklistRoutes } from './modules/whatsapp/blocklistRoutes';
import { registerOrderRoutes } from './modules/orders/routes';

const modules = [
  'auth',
  'clients',
  'whatsapp',
  'knowledge',
  'pricing',
  'templates',
  'leads',
  'meetings',
  'conversations',
  'quotations',
  'rag',
  'ai'
];

export function createApp() {
  const app = express();

  const corsOptions = {
    origin: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
  };

  // Apply CORS to all routes
  app.use(cors(corsOptions));

  // Explicitly handle OPTIONS preflight for EVERY route
  // (Required so PATCH/DELETE don't get blocked by requireAuth before cors() can respond)
  app.options('*', cors(corsOptions));

  app.use(express.json({ limit: '25mb' }));

  app.use('/api/receipts', express.static(path.join(process.cwd(), 'uploads', 'receipts')));


  // ── Request logger (dev) ───────────────────────────────────────────────────
  app.use((req, _res, next) => {
    console.log(`[API] ${req.method} ${req.path}`);
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: '@blink/api',
      modules
    });
  });

  app.get('/api/platform/manifest', (_req, res) => {
    res.json({
      name: 'ABC Automations Platform',
      stage: 'foundation-scaffold',
      modules
    });
  });

  const apiRouter = Router();
  registerAuthRoutes(apiRouter);
  registerWhatsappWebhookRoutes(apiRouter);
  apiRouter.use(requireAuth);
  registerClientRoutes(apiRouter);
  registerWhatsappRoutes(apiRouter);
  registerKnowledgeRoutes(apiRouter);
  registerRagRoutes(apiRouter);
  registerLeadRoutes(apiRouter);
  registerConversationRoutes(apiRouter);
  registerPricingRoutes(apiRouter);
  registerQuotationRoutes(apiRouter);
  registerBlocklistRoutes(apiRouter);
  registerOrderRoutes(apiRouter);
  app.use('/api', apiRouter);

  return app;
}
