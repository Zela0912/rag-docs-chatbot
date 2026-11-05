import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { CHAT_LIMITS, type ChatEvent } from '../../../shared/chat-protocol.ts';
import { type ChatDeps, runChat } from '../chat/service.ts';
import { type Logger, serializeError } from '../logger.ts';

const ChatRequestSchema = z.object({
  question: z.string().trim().min(1).max(CHAT_LIMITS.questionMaxChars),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(CHAT_LIMITS.turnMaxChars) }))
    .max(CHAT_LIMITS.historyMaxTurns)
    .default([]),
});

/**
 * POST /api/chat answers a question as a stream of Server-Sent Events
 * (see shared/chat-protocol.ts). Invalid input gets a plain 400 JSON response.
 */
export function chatRouter(deps: ChatDeps & { logger: Logger }): Router {
  const { logger } = deps;
  const router = Router();

  router.post('/api/chat', async (req, res) => {
    const parsed = ChatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request: send { question: string, history?: ChatTurn[] }.' });
      return;
    }

    const requestId = randomUUID();
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Stops nginx-style proxies from buffering the stream into one late chunk.
      'X-Accel-Buffering': 'no',
      'X-Request-Id': requestId,
    });
    const emit = (e: ChatEvent) => res.write(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);

    // Stop generating (and paying for tokens) if the user closes the tab mid-answer.
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) abort.abort();
    });

    try {
      const outcome = await runChat(
        { requestId, question: parsed.data.question, history: parsed.data.history, signal: abort.signal },
        deps,
        emit,
      );
      // We log shape and cost, never the question text: support chats can contain personal data.
      logger.info('chat.completed', {
        requestId,
        questionChars: parsed.data.question.length,
        historyTurns: parsed.data.history.length,
        topScore: outcome.topScore,
        sources: outcome.sources.length,
        cited: outcome.cited.length,
        notFound: outcome.notFound,
        skippedModel: outcome.skippedModel,
        queryRewrite: outcome.queryRewrite,
        inputTokens: outcome.usage?.inputTokens ?? 0,
        outputTokens: outcome.usage?.outputTokens ?? 0,
        retrievalMs: Math.round(outcome.retrievalMs),
        totalMs: Math.round(outcome.totalMs),
      });
    } catch (err) {
      if (abort.signal.aborted) {
        logger.info('chat.aborted', { requestId });
      } else {
        logger.error('chat.failed', { requestId, error: serializeError(err) });
        emit({
          event: 'error',
          data: { message: 'The assistant is temporarily unavailable. Please try again.', requestId },
        });
      }
    }
    res.end();
  });

  return router;
}
