import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/abc_platform'),
  EVOLUTION_API_BASE_URL: z.string().default('http://localhost:8080'),
  EVOLUTION_API_KEY: z.string().default('change-me-evolution-local'),
  JWT_SECRET: z.string().default('dev-secret-change-me'),
  GEMINI_API_KEY: z.string().optional(),
  WHATSAPP_WEBHOOK_BASE_URL: z.string().optional()
});

export const env = envSchema.parse(process.env);
