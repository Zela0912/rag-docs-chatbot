import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.ts';
import { openai } from '../openai.ts';
import { NOT_FOUND_ANSWER, citedSourceIds, systemPrompt, userMessage } from '../prompt.ts';
import type { Retriever } from '../retrieve.ts';

const ChatRequest = z.object({
  question: z.string().trim().min(1).max(2000),
  // Previous turns, so follow-ups like "and on the annual plan?" make sense.
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) }))
    .max(10)
    .default([]),
});

/**
 * POST /api/chat streams Server-Sent Events:
 *   sources -> the chunks the answer may cite (sent first, so the UI can show them immediately)
 *   delta   -> a piece of answer text
 *   done    -> which source numbers were actually cited
 *   error   -> something failed mid-stream
 */
export function chatRouter(retriever: Retriever): Router {
  const router = Router();

  router.post('/api/chat', async (req, res) => {
    const parsed = ChatRequest.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', issues: parsed.error.issues });
      return;
    }
    const { question, history } = parsed.data;

    // A follow-up on its own ("what about refunds?") retrieves badly, so we search with
    // the previous user question as extra context.
    const previousQuestion = history.findLast((m) => m.role === 'user')?.content;
    const searchQuery = previousQuestion ? `${previousQuestion}\n${question}` : question;
    const hits = (await retriever.search(searchQuery, config.topK)).filter((h) => h.score >= config.minScore);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    const sources = hits.map((hit, i) => ({
      id: i + 1,
      document: hit.title,
      file: hit.file,
      location: hit.location,
      text: hit.text,
      score: Math.round(hit.score * 1000) / 1000,
    }));
    send('sources', sources);

    // Nothing relevant: answer "not found" without calling the model. Cheaper, and it can't hallucinate.
    if (hits.length === 0) {
      send('delta', { text: NOT_FOUND_ANSWER });
      send('done', { cited: [] });
      res.end();
      return;
    }

    // Stop paying for tokens if the user closes the tab mid-answer.
    const abort = new AbortController();
    res.on('close', () => abort.abort());

    let answer = '';
    try {
      const stream = await openai.responses.create(
        {
          model: config.chatModel,
          instructions: systemPrompt(config.productName),
          input: [...history, { role: 'user', content: userMessage(question, hits) }],
          stream: true,
        },
        { signal: abort.signal },
      );

      for await (const event of stream) {
        if (event.type === 'response.output_text.delta') {
          answer += event.delta;
          send('delta', { text: event.delta });
        }
      }
      send('done', { cited: citedSourceIds(answer, sources.length) });
    } catch (err) {
      if (!abort.signal.aborted) {
        console.error('Chat completion failed:', err);
        send('error', { message: 'The assistant is temporarily unavailable. Please try again.' });
      }
    }
    res.end();
  });

  return router;
}
