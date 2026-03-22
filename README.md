# Blink Automations Platform

This workspace now contains the foundation for a multi-client WhatsApp automation platform.

## Workspace Layout

```text
apps/
  web/        Next.js dashboard shell
  api/        TypeScript API shell
packages/
  database/   Prisma schema and database package
  shared/     Shared constants and types
  ai/         Prompt and orchestration utilities
  parsers/    Document parsing utilities
openwa-bot/   Existing WhatsApp bot prototype
evolution-api-lite/ Existing WhatsApp transport service
```

## Current Stage

The new platform scaffold includes:

- npm workspaces at the repo root
- a dashboard shell in `apps/web`
- an API shell in `apps/api`
- the initial multi-tenant Prisma schema in `packages/database/prisma/schema.prisma`
- shared package placeholders for AI and parsing logic

## Suggested Next Steps

1. Install workspace dependencies:

```bash
npm install
```

2. Generate Prisma client:

```bash
npm run db:generate
```

3. Run the new apps:

```bash
npm run dev:web
npm run dev:api
```

4. Keep existing services available during migration:

```bash
npm run dev:n8n
npm run dev:bot
```

## Immediate Build Priorities

- wire authentication into `apps/web` and `apps/api`
- connect `apps/api` to Prisma
- add client onboarding and WhatsApp instance endpoints
- add file upload and ingestion jobs
- migrate the current bot flow into client-aware conversation services
