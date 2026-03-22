import { env } from './apps/api/src/common/config/env';

async function evolutionRequest<T = any>(path: string, method: string, body?: unknown): Promise<T> {
  const url = `${env.EVOLUTION_API_BASE_URL.replace(/\/+$/, '')}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      apikey: env.EVOLUTION_API_KEY
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const raw = await res.text();
  let data: any;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { raw };
  }

  if (!res.ok) {
    const message = data?.response?.message ?? data?.message ?? raw;
    throw new Error(`Evolution API ${method} ${path} failed (${res.status}): ${JSON.stringify(message)}`);
  }

  return data as T;
}

async function main() {
  console.log('Testing block contact...');
  try {
    const res = await evolutionRequest('/chat/updateBlockStatus/client-dinesh-primary', 'POST', {
      number: '120921146785888@lid',
      status: 'block'
    });
    console.log('Success:', res);
  } catch (err) {
    console.error('Failure:', err);
  }
}

main();
