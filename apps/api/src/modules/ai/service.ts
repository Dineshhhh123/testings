import { env } from '../../common/config/env';
import { buildSystemPrompt } from '@blink/ai/index';
import { prisma } from '@blink/database/src/client';

const GEMINI_MODEL = 'gemini-2.5-flash';

async function callGemini(prompt: string): Promise<string> {
  if (!env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(
    env.GEMINI_API_KEY
  )}`;

  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 512
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const json: any = await res.json();
  if (!res.ok) {
    const message = json?.error?.message || JSON.stringify(json);
    throw new Error(`Gemini error: ${message}`);
  }

  const text: string | undefined =
    json.candidates?.[0]?.content?.parts?.[0]?.text ??
    json.candidates?.[0]?.outputText ??
    undefined;

  if (!text) {
    throw new Error('Gemini returned no text');
  }

  return text.trim();
}

export async function generateAiReplyForConversation(
  clientId: string,
  conversationId: string,
  userText: string
): Promise<string> {
  // Load recent messages for context
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, clientId }
  });

  if (!conversation) {
    throw new Error('Conversation not found');
  }

  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    take: 30
  });

  // Very simple text-based retrieval: look for chunks containing last user text
  const trimmed = userText.trim();
  const chunks =
    trimmed.length > 3
      ? await prisma.knowledgeChunk.findMany({
          where: {
            clientId,
            content: {
              contains: trimmed,
              mode: 'insensitive'
            }
          },
          orderBy: { createdAt: 'desc' },
          take: 5
        })
      : [];

  const retrievedTexts = chunks.map((c) => c.content);

  const systemPrompt = buildSystemPrompt({
    clientId,
    conversationState: conversation.state,
    retrievedChunks: retrievedTexts
  });

  const historyText = messages
    .map((m) => {
      const speaker =
        m.direction === 'IN' ? 'User' : m.direction === 'OUT' ? 'Assistant' : m.role || 'System';
      return `${speaker}: ${m.text || ''}`;
    })
    .join('\n');

  const finalPrompt = [
    systemPrompt,
    '',
    'Conversation so far:',
    historyText || '(no previous messages)',
    '',
    'Latest user message:',
    userText,
    '',
    'Reply as the assistant. Be concise, friendly, and focused on helping close the sale or move the conversation forward.'
  ].join('\n');

  return callGemini(finalPrompt);
}

