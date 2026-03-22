// Load environment variables FIRST — before any other import that might read process.env
// Walk up from apps/api/src → apps/api → apps → monorepo root (testing/testing)
import { resolve } from 'node:path';
import dotenv from 'dotenv';
// __dirname = apps/api/src  →  ../../../.env = testing/testing/.env
dotenv.config({ path: resolve(__dirname, '../../../.env'), override: false });
// Fallback: if the CWD is the root or apps/api
dotenv.config({ path: resolve(process.cwd(), '.env'), override: false });
dotenv.config({ path: resolve(process.cwd(), '../../.env'), override: false });



import { createServer } from 'node:http';

import { createApp } from './app';
import { env } from './common/config/env';

const app = createApp();
const server = createServer(app);

server.listen(env.PORT, () => {
  console.log(`@blink/api listening on http://localhost:${env.PORT}`);
});

