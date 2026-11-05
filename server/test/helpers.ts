import type { AddressInfo } from 'node:net';
import type { ChatEvent } from '../../shared/chat-protocol.ts';
import { createApp } from '../src/app.ts';
import type { AnswerChunk, Answerer, AnswerRequest, Embedder } from '../src/llm/types.ts';
import { silentLogger } from '../src/logger.ts';
import { Retriever } from '../src/retrieve.ts';
import { Store } from '../src/store.ts';

const DIMENSIONS = 256;

/**
 * Deterministic bag-of-words "embedding": texts that share words get similar vectors.
 * Good enough to test retrieval logic without calling a real model.
 */
export function fakeEmbedder(model = 'fake-embedding'): Embedder & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    model,
    calls,
    async embed(texts) {
      calls.push(texts);
      const vectors = texts.map((text) => {
        const v = new Float32Array(DIMENSIONS);
        for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
          let h = 0;
          for (const ch of word) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
          v[h % DIMENSIONS] += 1;
        }
        return v;
      });
      return { vectors, tokens: texts.join(' ').split(/\s+/).length };
    },
  };
}

/**
 * An Answerer that replays scripted chunks and records what it was asked.
 * `rewrite` handles follow-up rewriting; by default it returns the latest message unchanged.
 */
export function fakeAnswerer(
  script: (request: AnswerRequest) => AnswerChunk[] | Promise<AnswerChunk[]>,
  rewrite: (latestMessage: string) => string = (latest) => latest,
): Answerer & { requests: AnswerRequest[]; completions: AnswerRequest[] } {
  const requests: AnswerRequest[] = [];
  const completions: AnswerRequest[] = [];
  return {
    model: 'fake-chat',
    requests,
    completions,
    async *stream(request) {
      requests.push(request);
      for (const chunk of await script(request)) {
        if (request.signal.aborted) throw new Error('aborted');
        yield chunk;
      }
    },
    async complete(request) {
      completions.push(request);
      const latest = /Latest message: (.*)$/s.exec(request.input[0].content)?.[1] ?? '';
      return { text: rewrite(latest), usage: { inputTokens: 30, outputTokens: 10 } };
    },
  };
}

export function textChunks(...parts: string[]): AnswerChunk[] {
  return [
    ...parts.map((text) => ({ type: 'delta', text }) as const),
    { type: 'usage', usage: { inputTokens: 100, outputTokens: 20 } },
  ];
}

/** A Store in memory, pre-filled with one document per entry. */
export async function seededRetriever(
  docs: { file: string; title: string; chunks: { location: string; text: string }[] }[],
  embedder: Embedder = fakeEmbedder(),
): Promise<{ store: Store; retriever: Retriever }> {
  const store = new Store(':memory:');
  for (const doc of docs) {
    const { vectors } = await embedder.embed(doc.chunks.map((c) => `${doc.title}\n${c.location}\n\n${c.text}`));
    store.replaceDocument(
      { file: doc.file, title: doc.title, hash: 'h', model: embedder.model },
      doc.chunks.map((c, i) => ({ ...c, embedding: vectors[i] })),
    );
  }
  return { store, retriever: new Retriever(store, embedder) };
}

/** Starts the real Express app on a random port. Call `close()` when done. */
export async function startTestServer(options: {
  retriever: Retriever;
  answerer: Answerer;
  minScore?: number;
  rateLimitPerMinute?: number;
}) {
  const app = createApp({
    retriever: options.retriever,
    answerer: options.answerer,
    settings: { topK: 3, minScore: options.minScore ?? 0.2, productName: 'TestCo' },
    logger: silentLogger,
    rateLimitPerMinute: options.rateLimitPerMinute ?? 1000,
    trustProxy: 0,
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** POST /api/chat and collect the parsed SSE events. */
export async function postChat(
  baseUrl: string,
  body: unknown,
): Promise<{ status: number; events: ChatEvent[]; json?: unknown }> {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.headers.get('content-type')?.startsWith('text/event-stream')) {
    return { status: res.status, events: [], json: await res.json() };
  }
  const raw = await res.text();
  const events = raw
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const event = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      return { event, data: JSON.parse(data ?? 'null') } as ChatEvent;
    });
  return { status: res.status, events };
}
