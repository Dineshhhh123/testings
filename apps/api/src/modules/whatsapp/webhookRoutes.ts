import type { Request, Response, Router } from 'express';

import { prisma } from '@blink/database/src/client';
import { sendPdf, sendText } from './evolutionClient';
import { env } from '../../common/config/env';
import { generateAiReplyForConversation } from '../ai/service';
import { generateQuotationPdfForQuote } from '../quotations/pdf';

type EvolutionWebhookPayload = {
  event?: string;
  data?: any;
  sender?: string;
};

type CartItem = {
  category?: string;
  productId?: string;
  productName?: string;
  packQuantity?: number | null;
  rate?: number | null;
  quantity?: number | null;
  total?: number | null;
};

type ConversationCart = {
  // Accumulated items for this quotation
  items?: CartItem[];

  // Fields for the currently edited item
  category?: string;
  productId?: string;
  productName?: string;
  packQuantity?: number | null;
  rate?: number | null;
  quantity?: number | null;
  total?: number | null;
  hasDiscount?: boolean;
};

function mapConnectionStateToStatus(state?: string): 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR' {
  const raw = String(state || '').toLowerCase();
  if (!raw) return 'DISCONNECTED';
  if (raw === 'open') return 'CONNECTED';
  if (raw === 'connecting') return 'CONNECTING';
  if (raw === 'close' || raw === 'closed' || raw === 'disconnected') return 'DISCONNECTED';
  return 'ERROR';
}

function isIncomingMessagePayload(payload: EvolutionWebhookPayload): boolean {
  const status = String(payload.data?.status || '').toUpperCase();
  return (
    String(payload.event || '').toLowerCase() === 'messages.upsert' &&
    payload.data &&
    payload.data.key &&
    payload.data.key.fromMe === false &&
    (status === '' || status === 'DELIVERY_ACK')
  );
}

function extractMessageText(message: any): string {
  if (!message) return '';
  if (typeof message.conversation === 'string') return message.conversation;
  if (typeof message.text === 'string') return message.text;
  if (message.extendedTextMessage && typeof message.extendedTextMessage.text === 'string') {
    return message.extendedTextMessage.text;
  }
  if (message.imageMessage && typeof message.imageMessage.caption === 'string') {
    return message.imageMessage.caption;
  }
  if (message.videoMessage && typeof message.videoMessage.caption === 'string') {
    return message.videoMessage.caption;
  }
  return '';
}

function parseCart(summary?: string | null): ConversationCart {
  if (!summary) return {};
  try {
    const parsed = JSON.parse(summary);
    if (parsed && typeof parsed === 'object') {
      return parsed as ConversationCart;
    }
    return {};
  } catch {
    return {};
  }
}

function stringifyCart(cart: ConversationCart): string {
  return JSON.stringify(cart);
}

async function getCategoriesForClient(clientId: string) {
  return prisma.pricingItem.findMany({
    where: { clientId },
    select: { category: true },
    distinct: ['category'],
    orderBy: { category: 'asc' }
  });
}

async function getProductsForCategory(clientId: string, category: string) {
  return prisma.pricingItem.findMany({
    where: { clientId, category },
    orderBy: { product: 'asc' }
  });
}

export function registerWhatsappWebhookRoutes(router: Router) {
  router.post('/webhooks/evolution/:instanceName', async (req: Request, res: Response) => {
    try {
      const rawInstanceName = (req.params as any).instanceName as string | string[];
      const instanceName: string = Array.isArray(rawInstanceName)
        ? rawInstanceName[0] || ''
        : rawInstanceName || '';
      const payload = (req.body || {}) as EvolutionWebhookPayload;

      const instance = await prisma.whatsappInstance.findUnique({
        where: { instanceName }
      });

      if (!instance) {
        res.status(404).json({ error: 'WhatsappInstance not found' });
        return;
      }

      // Handle connection.update events to keep instance status in sync
      if (String(payload.event || '').toLowerCase() === 'connection.update') {
        const state = payload.data?.state as string | undefined;
        const status = mapConnectionStateToStatus(state);

        await prisma.whatsappInstance.update({
          where: { instanceName },
          data: {
            status,
            lastConnectedAt: status === 'CONNECTED' ? new Date() : instance.lastConnectedAt,
            lastError: status === 'ERROR' ? String(payload.data?.error || '') || null : null
          }
        });

        res.status(200).json({ ok: true, status });
        return;
      }

      if (!isIncomingMessagePayload(payload)) {
        res.status(200).json({ ignored: true });
        return;
      }

      const clientId = instance.clientId;
      const remoteJid: string = payload.data?.key?.remoteJid || '';
      const messageId: string = String(payload.data?.key?.id || '');
      const rawMessage = payload.data?.message || {};
      const text = String(extractMessageText(rawMessage) || '').trim();

      const isGroupMessage = String(remoteJid).endsWith('@g.us');
      const isDirectMessage = /@(s\.whatsapp\.net|c\.us|lid)$/i.test(String(remoteJid || ''));

      if (!remoteJid || !messageId || !text || isGroupMessage || !isDirectMessage) {
        res.status(200).json({ ignored: true });
        return;
      }

      const senderJid: string =
        payload.sender || payload.data?.sender || payload.data?.from || remoteJid;

      const externalChatId = remoteJid;

      function extractPhone(jid: string | null | undefined): string | null {
        if (!jid) return null;
        const raw = String(jid).split('@')[0] || '';
        const digits = raw.replace(/\D+/g, '');
        // Basic validation: 8–15 digits -> looks like real phone
        if (digits.length < 8 || digits.length > 15) return null;
        return digits;
      }

      // Prefer chat JID phone; fall back to sender JID if needed
      let phone = extractPhone(remoteJid);
      if (!phone) {
        phone = extractPhone(senderJid);
      }

      const externalUserJid = remoteJid;
      const displayName: string | undefined = undefined; // do not read name from WhatsApp profile

      if (phone) {
        const blockedNumbers = await prisma.blockedNumber.findMany({
          where: { clientId },
          select: { phone: true }
        });

        const isBlocked = blockedNumbers.some((b) => {
          if (b.phone === phone) return true;
          // If the user uploaded a 10-digit number without a country code, the incoming WhatsApp phone (e.g. 918300...)
          // will end with the user's uploaded number. Check suffix matches for numbers at least 7 digits long.
          if (b.phone.length >= 7 && phone!.endsWith(b.phone)) return true;
          if (phone!.length >= 7 && b.phone.endsWith(phone!)) return true;
          return false;
        });

        if (isBlocked) {
          res.status(200).json({ ignored: true, blocked: true });
          return;
        }
      }

      // Upsert lead for this external user
      const lead = await prisma.lead.upsert({
        where: {
          clientId_externalUserJid: {
            clientId,
            externalUserJid
          }
        },
        create: {
          clientId,
          externalUserJid,
          displayName: null,
          phone,
          status: 'NEW',
          sourceChannel: 'whatsapp'
        },
        update: {
          // Never overwrite displayName automatically; it is set only when user explicitly gives their name
          phone: phone ?? undefined
        }
      });

      if (lead.status === 'BLOCKED') {
        res.status(200).json({ ignored: true, blocked: true });
        return;
      }

      // Upsert conversation for this chat
      const conversation = await prisma.conversation.upsert({
        where: {
          clientId_externalChatId: {
            clientId,
            externalChatId
          }
        },
        create: {
          clientId,
          externalChatId,
          channel: 'whatsapp',
          state: 'awaiting_name',
          leadId: lead.id
        },
        update: {
          leadId: lead.id
        }
      });

      // Avoid duplicate messages by externalMessageId
      if (messageId) {
        const existing = await prisma.message.findFirst({
          where: {
            conversationId: conversation.id,
            externalMessageId: messageId
          }
        });

        if (existing) {
          res.status(200).json({ duplicate: true });
          return;
        }
      }

      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          externalMessageId: messageId || null,
          direction: 'IN',
          role: 'user',
          text,
          rawPayload: payload,
          sentAt: new Date()
        }
      });
      const trimmed = text.trim();
      const lowerTrimmed = trimmed.toLowerCase();
      let state = conversation.state || 'awaiting_name';
      let cart: ConversationCart = parseCart(conversation.summary);
      let replyText = '';

      const pricingCount = await prisma.pricingItem.count({ where: { clientId } });

      if (!pricingCount) {
        // No pricing configured yet: fall back to AI or a simple greeting
        replyText =
          'Hi! I am your ABC WhatsApp assistant. Pricing has not been configured yet. Please contact the workspace owner.';
        if (env.GEMINI_API_KEY) {
          try {
            replyText = await generateAiReplyForConversation(clientId, conversation.id, text);
          } catch (aiErr: any) {
            // eslint-disable-next-line no-console
            console.error('AI reply failed, falling back to greeting:', aiErr);
          }
        }
      } else {
        const isRestartCommand = ['hi', 'hello', 'hey', 'start', 'menu'].includes(lowerTrimmed);
        const isBackCommand = ['back', 'b'].includes(lowerTrimmed);
        const isCancelCommand = ['cancel', 'stop'].includes(lowerTrimmed);

        // Global "cancel" – reset the flow completely
        if (isCancelCommand) {
          state = 'awaiting_name';
          cart = {};
          replyText =
            'Okay, I’ve cancelled the current quotation. You can tell me your name again or send "hi" to start a new order.';

          await prisma.conversation.update({
            where: { id: conversation.id },
            data: { state, summary: null }
          });
        }
        // Allow user to restart flow from any state with simple commands like "hi" or "menu"
        else if (isRestartCommand) {
          const existingName = lead.displayName || displayName || null;
          const categories = await getCategoriesForClient(clientId);

          if (!categories.length) {
            replyText =
              `Hi ${existingName || 'there'}, I don’t have any pricing set up yet. ` +
              `Please ask your account owner to upload a pricing sheet in the dashboard.`;
            state = 'awaiting_name';
          } else if (existingName) {
            const lines = categories.map((c, idx) => `${idx + 1}. ${c.category}`);
            replyText =
              `Welcome back, ${existingName}!\n\n` +
              `Here are our main product categories:\n` +
              lines.join('\n') +
              `\n\nPlease reply with the number of the category you’re interested in.`;
            state = 'awaiting_category';
          } else {
            replyText =
              'Hi! I am your ABC WhatsApp assistant. Please tell me your name so I can help you with products, pricing, and quotations.';
            state = 'awaiting_name';
          }

          await prisma.conversation.update({
            where: { id: conversation.id },
            data: { state, summary: null }
          });
        } else if (isBackCommand) {
          // Step back one level depending on current state
          switch (state) {
            case 'awaiting_category': {
              const existingName = lead.displayName || displayName || null;
              if (existingName) {
                const categories = await getCategoriesForClient(clientId);
                if (!categories.length) {
                  replyText =
                    `Hi ${existingName}, I don’t have any pricing set up yet. ` +
                    `Please ask your account owner to upload a pricing sheet in the dashboard.`;
                  state = 'awaiting_name';
                } else {
                  const lines = categories.map((c, idx) => `${idx + 1}. ${c.category}`);
                  replyText =
                    `Welcome back, ${existingName}!\n\n` +
                    `Here are our main product categories:\n` +
                    lines.join('\n') +
                    `\n\nPlease reply with the number of the category you’re interested in.`;
                  state = 'awaiting_category';
                }
              } else {
                replyText =
                  'Hi! I am your ABC WhatsApp assistant. Please tell me your name so I can help you with products, pricing, and quotations.';
                state = 'awaiting_name';
              }

              await prisma.conversation.update({
                where: { id: conversation.id },
                data: { state, summary: null }
              });
              break;
            }

            case 'awaiting_product': {
              // Go back to category selection
              const categories = await getCategoriesForClient(clientId);
              if (!categories.length) {
                replyText =
                  'I don’t have any pricing set up yet. Please ask your account owner to upload a pricing sheet in the dashboard.';
                state = 'awaiting_name';
              } else {
                const lines = categories.map((c, idx) => `${idx + 1}. ${c.category}`);
                replyText =
                  'No problem, let’s choose a category again.\n\n' +
                  `Here are our main product categories:\n` +
                  lines.join('\n') +
                  `\n\nPlease reply with the number of the category you’re interested in.`;
                state = 'awaiting_category';
              }

              cart = {};
              await prisma.conversation.update({
                where: { id: conversation.id },
                data: { state, summary: null }
              });
              break;
            }

            case 'awaiting_quantity': {
              // Go back to product list for the current category
              if (!cart.category) {
                state = 'awaiting_category';
                replyText =
                  'Let’s pick a category again. Please reply with the number of the category you’re interested in.';
                await prisma.conversation.update({
                  where: { id: conversation.id },
                  data: { state, summary: null }
                });
                break;
              }

              const products = await getProductsForCategory(clientId, cart.category);
              if (!products.length) {
                replyText =
                  `I couldn’t find any products under “${cart.category}”. Please choose another category.`;
                state = 'awaiting_category';
                cart = {};
                await prisma.conversation.update({
                  where: { id: conversation.id },
                  data: { state, summary: null }
                });
                break;
              }

              const lines = products.slice(0, 10).map((p, i) => {
                const pack = p.packQuantity ? ` (pack of ${p.packQuantity})` : '';
                const rate = p.rate ? ` – ₹${Number(p.rate).toFixed(2)}` : '';
                const discountNum = p.discount ? Number(p.discount) : 0;
                const discount = discountNum > 0 ? ` - Discount: ${discountNum}%` : ' - Discount: nil';
                return `${i + 1}. ${p.product}${pack}${rate}${discount}`;
              });

              replyText =
                `No problem, let’s pick a product again under “${cart.category}”.\n\n` +
                `Here are some options:\n` +
                lines.join('\n') +
                `\n\nPlease reply with the number of the product you’d like.`;

              // Clear product-specific details but keep category
              cart = { category: cart.category };
              state = 'awaiting_product';

              await prisma.conversation.update({
                where: { id: conversation.id },
                data: { state, summary: stringifyCart(cart) }
              });
              break;
            }

            case 'awaiting_confirmation': {
              // Go back to quantity entry
              if (!cart.productId || !cart.productName || cart.rate == null) {
                state = 'awaiting_category';
                cart = {};
                replyText =
                  'Let’s start again from categories. Please reply with the number of the category you’re interested in.';
                await prisma.conversation.update({
                  where: { id: conversation.id },
                  data: { state, summary: null }
                });
                break;
              }

              const rate = cart.rate ?? 0;
              const packText = cart.packQuantity
                ? ` (pack of ${cart.packQuantity})`
                : '';

              replyText =
                `No problem, let’s adjust the quantity for “${cart.productName}${packText}”.\n` +
                `Each pack is ₹${rate.toFixed(2)}.\n` +
                'How many packs would you like? Please reply with a number (e.g., 1, 2, 5).';

              // Clear previous quantity/total
              cart = {
                ...cart,
                quantity: null,
                total: null
              };
              state = 'awaiting_quantity';

              await prisma.conversation.update({
                where: { id: conversation.id },
                data: { state, summary: stringifyCart(cart) }
              });
              break;
            }

            default: {
              // For any other state, behave similar to cancel
              state = 'awaiting_name';
              cart = {};
              replyText =
                'Okay, I’ve cancelled the current quotation. You can tell me your name again or send "hi" to start a new order.';

              await prisma.conversation.update({
                where: { id: conversation.id },
                data: { state, summary: null }
              });
              break;
            }
          }
        } else {
          const looksLikeQuestion =
            /[?؟]$/.test(trimmed) ||
            /^(what|how|why|when|where|who|which|can|could|will|would|do|does|is|are|am)\b/i.test(
              trimmed
            );

          require('fs').appendFileSync(
            'debug-webhook.txt',
            JSON.stringify({ text, trimmed, lowerTrimmed, looksLikeQuestion, envHasKey: !!env.GEMINI_API_KEY, state, leadId: lead.id }) + '\\n'
          );

          if (looksLikeQuestion && env.GEMINI_API_KEY) {
            try {
              replyText = await generateAiReplyForConversation(clientId, conversation.id, text);
            } catch (aiErr: any) {
              // eslint-disable-next-line no-console
              console.error('AI reply failed, falling back', aiErr);
              replyText = 'Sorry, I am having trouble answering questions right now. Let’s continue with your order.';
            }
          } else {
            switch (state) {
              case 'awaiting_name': {
                const existingName = lead.displayName || null;
                const name = trimmed || existingName || 'there';

            await prisma.lead.update({
              where: { id: lead.id },
              data: { displayName: name }
            });

            const categories = await getCategoriesForClient(clientId);

            if (!categories.length) {
              replyText =
                `Hi ${name}, I don’t have any pricing set up yet. ` +
                `Please ask your account owner to upload a pricing sheet in the dashboard.`;
              state = 'awaiting_name';
            } else {
              const lines = categories.map((c, idx) => `${idx + 1}. ${c.category}`);
              replyText =
                `Nice to meet you, ${name}!\n\n` +
                `Here are our main product categories:\n` +
                lines.join('\n') +
                `\n\nPlease reply with the number of the category you’re interested in.`;
              state = 'awaiting_category';
            }

            await prisma.conversation.update({
              where: { id: conversation.id },
              data: { state }
            });
            break;
          }

          case 'awaiting_category': {
            const categories = await getCategoriesForClient(clientId);
            const idx = Number(trimmed);

            if (!Number.isInteger(idx) || idx < 1 || idx > categories.length) {
              replyText =
                `Please reply with a number between 1 and ${categories.length} to choose a category.\n` +
                'You can also send "hi" or "menu" to restart, or "cancel" to stop.';
              break;
            }

            const chosenCategory = categories[idx - 1].category;
            cart = { category: chosenCategory };

            const products = await getProductsForCategory(clientId, chosenCategory);

            if (!products.length) {
              replyText =
                `I couldn’t find any products under “${chosenCategory}”. ` +
                `Please choose another category.`;
              state = 'awaiting_category';
            } else {
              const lines = products.slice(0, 10).map((p, i) => {
                const pack = p.packQuantity ? ` (pack of ${p.packQuantity})` : '';
                const rate = p.rate ? ` – ₹${Number(p.rate).toFixed(2)}` : '';
                const discountNum = p.discount ? Number(p.discount) : 0;
                const discount = discountNum > 0 ? ` - Discount: ${discountNum}%` : ' - Discount: nil';
                return `${i + 1}. ${p.product}${pack}${rate}${discount}`;
              });

              replyText =
                `Great, you chose “${chosenCategory}”.\n\n` +
                `Here are some options:\n` +
                lines.join('\n') +
                `\n\nPlease reply with the number of the product you’d like.`;
              state = 'awaiting_product';
            }

            await prisma.conversation.update({
              where: { id: conversation.id },
              data: { state, summary: stringifyCart(cart) }
            });
            break;
          }

          case 'awaiting_product': {
            if (!cart.category) {
              state = 'awaiting_category';
              replyText =
                'Let’s pick a category first. Please send a category number.\nYou can also send "hi" or "menu" to restart, or "cancel" to stop.';
              await prisma.conversation.update({
                where: { id: conversation.id },
                data: { state, summary: stringifyCart(cart) }
              });
              break;
            }

            const products = await getProductsForCategory(clientId, cart.category);
            const idx = Number(trimmed);
            const isChoice =
              Number.isInteger(idx) && idx >= 1 && idx <= products.length;

            if (!isChoice) {
              // Non-numeric or out-of-range input: treat as a free-form question and let AI help
              if (env.GEMINI_API_KEY) {
                try {
                  const listText = products
                    .slice(0, 10)
                    .map((p, i) => {
                      const pack = p.packQuantity ? ` (pack of ${p.packQuantity})` : '';
                      const rate = p.rate ? ` – ₹${Number(p.rate).toFixed(2)}` : '';
                      const discountNum = p.discount ? Number(p.discount) : 0;
                      const discount = discountNum > 0 ? ` - Discount: ${discountNum}%` : ' - Discount: nil';
                      return `${i + 1}. ${p.product}${pack}${rate}${discount}`;
                    })
                    .join('\n');

                  const questionWithContext =
                    `Customer is choosing a product in category "${cart.category}".\n` +
                    `Available options:\n${listText}\n\n` +
                    `Customer message:\n"${text}"\n\n` +
                    `Briefly (2-3 short lines), compare or recommend options based on their message.\n` +
                    `End your reply with a clear instruction like: "To order now, reply with the product number (1, 2, 3, ...).".`;

                  replyText = await generateAiReplyForConversation(
                    clientId,
                    conversation.id,
                    questionWithContext
                  );
                } catch (aiErr: any) {
                  // eslint-disable-next-line no-console
                  console.error(
                    'AI reply in awaiting_product failed, falling back to numeric prompt',
                    aiErr
                  );
                  replyText =
                    `Please reply with a number between 1 and ${products.length} to choose a product.\n` +
                    'You can also send "back" to change category, "hi" or "menu" to restart, or "cancel" to stop.';
                }
              } else {
                replyText =
                  `Please reply with a number between 1 and ${products.length} to choose a product.\n` +
                  'You can also send "back" to change category, "hi" or "menu" to restart, or "cancel" to stop.';
              }

              break;
            }

            const chosen = products[idx - 1];
            const discountNum = chosen.discount ? Number(chosen.discount) : 0;
            const hasDiscount = discountNum > 0;

            const rateNum = chosen.rate ? Number(chosen.rate) : 0;
            const discountedRate = hasDiscount ? rateNum - (rateNum * discountNum / 100) : rateNum;
            cart = {
              ...cart,
              productId: chosen.id,
              productName: chosen.product,
              packQuantity: chosen.packQuantity ?? null,
              rate: discountedRate,
              hasDiscount: hasDiscount
            };

            const packText = chosen.packQuantity
              ? `One pack contains ${chosen.packQuantity} units. `
              : '';
            const rateText = hasDiscount && rateNum
              ? `Original: \u20B9${rateNum.toFixed(2)} | After ${discountNum}% discount: \u20B9${discountedRate.toFixed(2)}.`
              : (rateNum ? `Price: \u20B9${rateNum.toFixed(2)}.` : '');

            replyText =
              `You chose "${chosen.product}". \uD83C\uDF89\n\n` +
              `${packText}${rateText}\n` +
              `How many packs would you like? Please reply with a number (e.g., 1, 2, 5).`;

            state = 'awaiting_quantity';

            await prisma.conversation.update({
              where: { id: conversation.id },
              data: { state, summary: stringifyCart(cart) }
            });
            break;
          }

          case 'awaiting_quantity': {
            const qty = Number(trimmed);
            if (!cart.productId || !cart.productName) {
              state = 'awaiting_category';
              replyText =
                'Let’s start again. Please choose a category.\nYou can also send "hi" or "menu" to restart, or "cancel" to stop.';
              await prisma.conversation.update({
                where: { id: conversation.id },
                data: { state, summary: stringifyCart(cart) }
              });
              break;
            }
            if (trimmed.toLowerCase().includes('discount')) {
              if (cart.hasDiscount) {
                replyText = 'A discount is already applied to this product.\n\n' +
                  'Please reply with a positive number for the quantity (e.g., 1, 2, 5).';
              } else {
                replyText = 'Discount not available for this product pls contact administrator.\n\n' +
                  'Please reply with a positive number for the quantity (e.g., 1, 2, 5).';
              }
              break;
            }

            if (!Number.isFinite(qty) || qty <= 0) {
              replyText =
                'Please reply with a positive number for the quantity (e.g., 1, 2, 5).\n' +
                'You can also send "back" to change the product, "hi" or "menu" to restart, or "cancel" to stop.';
              break;
            }

            const rate = cart.rate ?? 0;
            const total = rate * qty;
            const packText = cart.packQuantity
              ? ` (pack of ${cart.packQuantity})`
              : '';

            cart = {
              ...cart,
              quantity: qty,
              total
            };

            const existingItems = Array.isArray(cart.items) ? cart.items : [];
            const itemsCountText = existingItems.length
              ? `You already have ${existingItems.length} item(s) in your quotation:\n` +
                existingItems
                  .slice(0, 5)
                  .map((item, index) => {
                    const itemRate = Number(item.rate ?? 0);
                    const itemQty = Number(item.quantity ?? 0);
                    const itemTotal =
                      typeof item.total === 'number'
                        ? item.total
                        : itemRate * itemQty;
                    return `${index + 1}. ${item.productName || ''} – ${itemQty} × ₹${itemRate.toFixed(
                      2
                    )} = ₹${itemTotal.toFixed(2)}`;
                  })
                  .join('\n') +
                (existingItems.length > 5 ? `\n(+ ${existingItems.length - 5} more item(s))\n\n` : '\n\n')
              : '';

            replyText =
              `${itemsCountText}Here is the summary for this product:\n\n` +
              `${qty} × ${cart.productName}${packText} @ ₹${rate.toFixed(2)} ` +
              `= ₹${total.toFixed(2)}\n\n` +
              `If this looks good, reply with "yes" to confirm and finalize your quotation now, ` +
              `reply with "more" to add this product and choose another one, ` +
              `or reply with "no" to change this product.`;

            state = 'awaiting_confirmation';

            await prisma.conversation.update({
              where: { id: conversation.id },
              data: { state, summary: stringifyCart(cart) }
            });

            break;
          }

          case 'awaiting_confirmation': {
            if (!cart.productId || !cart.productName || cart.quantity == null || cart.rate == null) {
              state = 'awaiting_name';
              replyText = 'Let’s start again. Please tell me your name.';
              await prisma.conversation.update({
                where: { id: conversation.id },
                data: { state, summary: null }
              });
              break;
            }

            const lower = trimmed.toLowerCase();
            const existingItems = Array.isArray(cart.items) ? cart.items : [];

            const currentItem: CartItem = {
              category: cart.category,
              productId: cart.productId,
              productName: cart.productName,
              packQuantity: cart.packQuantity ?? null,
              rate: cart.rate ?? 0,
              quantity: cart.quantity ?? 0,
              total: cart.total ?? (cart.rate ?? 0) * (cart.quantity ?? 0)
            };

            if (lower === 'more' || lower === 'm' || lower === 'add' || lower === 'another') {
              // Add current item to cart and go back to category selection to add more
              const newItems = [...existingItems, currentItem];
              cart = {
                items: newItems
              };

              const categories = await getCategoriesForClient(clientId);
              if (!categories.length) {
                replyText =
                  'I don’t have any pricing set up yet. Please ask your account owner to upload a pricing sheet in the dashboard.';
                state = 'awaiting_name';
              } else {
                const lines = categories.map((c, idx) => `${idx + 1}. ${c.category}`);
                replyText =
                  `Great, I’ve added this product to your quotation. ` +
                  `You now have ${newItems.length} item(s) in your quotation.\n\n` +
                  `If you want to add another product, please choose a category:\n` +
                  lines.join('\n') +
                  `\n\nYou can also reply "yes" at any time later to finalize your quotation with all items.`;
                state = 'awaiting_category';
              }

              await prisma.conversation.update({
                where: { id: conversation.id },
                data: { state, summary: stringifyCart(cart) }
              });
              break;
            }

            if (lower === 'yes' || lower === 'y') {
              const finalItems = [...existingItems, currentItem];
              const grandTotal = finalItems.reduce((sum, item) => {
                const itemTotal = item.total ?? (item.rate ?? 0) * (item.quantity ?? 0);
                return sum + (itemTotal || 0);
              }, 0);

              let quotationId: string | null = null;
              try {
                const quotation = await prisma.quotation.create({
                  data: {
                    clientId,
                    leadId: lead.id,
                    status: 'SENT',
                    summary: {
                      items: finalItems,
                      grandTotal
                    } as any
                  }
                });
                quotationId = quotation.id;
              } catch (e) {
                // eslint-disable-next-line no-console
                console.error('Failed to create quotation record', e);
              }

              if (quotationId) {
                try {
                  const { filePath, fileName } = await generateQuotationPdfForQuote(quotationId);
                  await sendPdf(instance.instanceName, remoteJid, filePath, fileName);
                } catch (e) {
                  // eslint-disable-next-line no-console
                  console.error('Failed to generate or send quotation PDF', e);
                }
              }

              replyText =
                'Thank you! I’ve generated your quotation and sent it as a PDF. If you need any changes, just let me know.';

              state = 'awaiting_name';
              cart = {};

              await prisma.conversation.update({
                where: { id: conversation.id },
                data: { state, summary: null }
              });
            } else if (lower === 'no' || lower === 'n') {
              // Discard current item but keep any previously added items
              const newCart: ConversationCart = {
                items: existingItems
              };
              cart = newCart;
              state = 'awaiting_category';
              const categories = await getCategoriesForClient(clientId);
              if (!categories.length) {
                replyText =
                  'I don’t have any pricing set up yet. Please ask your account owner to upload a pricing sheet in the dashboard.';
                state = 'awaiting_name';
              } else {
                const lines = categories.map((c, idx) => `${idx + 1}. ${c.category}`);
                const itemsCountText = existingItems.length
                  ? `You still have ${existingItems.length} item(s) in your quotation.\n\n`
                  : '';
                replyText =
                  `${itemsCountText}No problem. Let’s pick a category again. ` +
                  `Please reply with the number of the category you’re interested in.\n` +
                  'You can also send "hi" or "menu" to restart, "back" to adjust the previous step, or "cancel" to stop.';
              }

              await prisma.conversation.update({
                where: { id: conversation.id },
                data: { state, summary: stringifyCart(cart) }
              });
            } else {
              replyText =
                'Please reply "yes" to confirm the quotation, "more" to add this product and choose another one, or "no" to change this product.\n' +
                'You can also send "back" to adjust the quantity, "hi" or "menu" to restart, or "cancel" to stop.';
            }

            break;
          }

          default: {
            state = 'awaiting_name';
            replyText =
              'Hi! I am your ABC WhatsApp assistant. Please tell me your name so I can help you with products, pricing, and quotations.';
            await prisma.conversation.update({
              where: { id: conversation.id },
              data: { state }
            });
            break;
          }
        }
          }
        }
      }

      const outbound = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          direction: 'OUT',
          role: 'assistant',
          text: replyText,
          sentAt: new Date()
        }
      });

      try {
        await sendText(instance.instanceName, remoteJid, replyText);
      } catch (sendErr: any) {
        // eslint-disable-next-line no-console
        console.error('Failed to send Evolution reply', sendErr);
      }

      res.status(200).json({ processed: true, inboundMessageId: messageId, outboundId: outbound.id });
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('Evolution webhook error:', err);
      res.status(500).json({ processed: false, error: err?.message ?? 'Unknown error' });
    }
  });
}

