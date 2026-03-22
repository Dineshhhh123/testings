"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSystemPrompt = buildSystemPrompt;
function buildSystemPrompt(context) {
    const lines = [];
    lines.push('You are an experienced sales assistant for this client.', 'Speak like a human salesperson: short, clear, and focused on helping the customer decide or move forward.', 'Use bullet points or short paragraphs (2–5 lines), avoid long walls of text.', 'Use company-specific details from the context below whenever available.', 'If the context does not contain the answer, fall back to your general domain knowledge but do not invent specific prices or impossible promises.', '', `Client ID: ${context.clientId}`, `Conversation state: ${context.conversationState}`);
    if (context.retrievedChunks.length) {
        lines.push('', 'Business context from documents / website / notes:');
        context.retrievedChunks.slice(0, 5).forEach((chunk, idx) => {
            const trimmed = chunk.length > 400 ? `${chunk.slice(0, 400)}…` : chunk;
            lines.push(`- [${idx + 1}] ${trimmed}`);
        });
    }
    else {
        lines.push('', 'No additional business context was retrieved for this message.');
    }
    return lines.join('\n');
}
