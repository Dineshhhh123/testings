import fs from 'node:fs';

import { env } from '../../common/config/env';

type EvolutionMethod = 'GET' | 'POST' | 'DELETE';

async function evolutionRequest<T = any>(path: string, method: EvolutionMethod, body?: unknown): Promise<T> {
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

export async function sendText(instanceName: string, number: string, text: string) {
  return evolutionRequest(`/message/sendText/${encodeURIComponent(instanceName)}`, 'POST', {
    number,
    text,
    delay: 500,
    linkPreview: false
  });
}

export async function sendPdf(
  instanceName: string,
  number: string,
  filePath: string,
  fileName: string
) {
  const pdfBase64 = fs.readFileSync(filePath, { encoding: 'base64' });
  return evolutionRequest(`/message/sendMedia/${encodeURIComponent(instanceName)}`, 'POST', {
    number,
    mediatype: 'document',
    mimetype: 'application/pdf',
    caption: 'Your quotation PDF from ABC Automations.',
    media: pdfBase64,
    fileName,
    delay: 500
  });
}

export async function ensureEvolutionInstance(instanceName: string) {
  try {
    const webhookBase = env.WHATSAPP_WEBHOOK_BASE_URL?.replace(/\/+$/, '') ??
      `http://localhost:${env.PORT}/api/webhooks/evolution`;
    const webhookUrl = `${webhookBase}/${encodeURIComponent(instanceName)}`;

    await evolutionRequest('/instance/create', 'POST', {
      instanceName,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
      webhook: {
        url: webhookUrl,
        byEvents: false,
        base64: false,
        events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'CALL']
      }
    });
  } catch (err: any) {
    const msg = String(err?.message || '');
    if (!msg.toLowerCase().includes('already')) {
      throw err;
    }
  }

  const webhookBase = env.WHATSAPP_WEBHOOK_BASE_URL?.replace(/\/+$/, '') ??
    `http://localhost:${env.PORT}/api/webhooks/evolution`;
  const webhookUrl = `${webhookBase}/${encodeURIComponent(instanceName)}`;

  await evolutionRequest(`/webhook/set/${encodeURIComponent(instanceName)}`, 'POST', {
    webhook: {
      enabled: true,
      url: webhookUrl,
      byEvents: false,
      base64: false,
      events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'CALL']
    }
  });
}

export type EvolutionConnectResult = {
  instance?: {
    instanceName?: string;
    instanceId?: string;
    integration?: string;
    status?: string;
  };
  qrcode?: any;
};

export async function connectEvolutionInstance(instanceName: string): Promise<EvolutionConnectResult> {
  const data = await evolutionRequest<EvolutionConnectResult>(`/instance/connect/${encodeURIComponent(instanceName)}`, 'GET');
  return data;
}

export async function logoutEvolutionInstance(instanceName: string) {
  return evolutionRequest(`/instance/logout/${encodeURIComponent(instanceName)}`, 'DELETE');
}

export async function sendImage(
  instanceName: string,
  number: string,
  filePath: string,
  fileName: string,
  caption: string = ''
) {
  const base64 = fs.readFileSync(filePath, { encoding: 'base64' });
  const mimetype = filePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
  return evolutionRequest(`/message/sendMedia/${encodeURIComponent(instanceName)}`, 'POST', {
    number,
    mediatype: 'image',
    mimetype,
    caption,
    media: base64,
    fileName,
    delay: 500
  });
}

export async function getMediaBase64(instanceName: string, message: any): Promise<string | null> {
  try {
    const data = await evolutionRequest<{ base64?: string }>(
      `/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`,
      'POST',
      { message }
    );
    return data?.base64 || null;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to get media base64 from message', err);
    return null;
  }
}

export async function sendButtons(
  instanceName: string,
  number: string,
  text: string,
  buttons: { id: string; text: string }[],
  footer?: string
) {
  return evolutionRequest(`/message/sendButtons/${encodeURIComponent(instanceName)}`, 'POST', {
    number,
    buttons: buttons.map(b => ({
      buttonId: b.id,
      buttonText: { displayText: b.text },
      type: 1
    })),
    text,
    footer,
    delay: 500
  });
}
