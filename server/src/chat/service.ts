import { performance } from 'node:perf_hooks';
import { CHAT_LIMITS, type ChatEvent, type ChatTurn, type Source } from '../../../shared/chat-protocol.ts';
import type { Answerer, TokenUsage } from '../llm/types.ts';
import {
  citedSourceIds,
  cleanHistory,
  isNotFound,
  NOT_FOUND_ANSWER,
  REWRITE_INSTRUCTIONS,
  rewriteInput,
  systemPrompt,
  userMessage,
} from '../prompt.ts';
import type { Retriever } from '../retrieve.ts';

export interface ChatSettings {
  topK: number;
  minScore: number;
  productName: string;
}

export interface ChatDeps {
  retriever: Retriever;
  answerer: Answerer;
  settings: ChatSettings;
}

export interface ChatInput {
  requestId: string;
  question: string;
  history: ChatTurn[];
  signal: AbortSignal;
}

/** What happened during one request; logged by the route and scored by the eval script. */
export interface ChatOutcome {
  answer: string;
  sources: Source[];
  cited: number[];
  notFound: boolean;
  /** True when no chunk passed the threshold, so the chat model was never called. */
  skippedModel: boolean;
  /** How the retrieval query was built: as-is, rewritten by the model, or by the fallback heuristic. */
  queryRewrite: SearchQuery['rewrite'];
  topScore: number | null;
  /** Tokens for the answer plus the follow-up rewrite, if any. */
  usage: TokenUsage | null;
  retrievalMs: number;
  totalMs: number;
}

/**
 * One question -> retrieve -> (maybe) answer. Transport-agnostic: the HTTP route turns
 * `emit` into Server-Sent Events, the eval script just collects them.
 */
export async function runChat(
  input: ChatInput,
  deps: ChatDeps,
  emit: (event: ChatEvent) => void,
): Promise<ChatOutcome> {
  const { retriever, answerer, settings } = deps;
  const started = performance.now();

  const search = await buildSearchQuery(input.question, input.history, answerer, input.signal);
  const allHits = await retriever.search(search.query, settings.topK);
  const hits = allHits.filter((hit) => hit.score >= settings.minScore);
  const retrievalMs = performance.now() - started;

  const sources: Source[] = hits.map((hit, i) => ({
    id: i + 1,
    document: hit.title,
    file: hit.file,
    location: hit.location,
    text: hit.text,
    score: Math.round(hit.score * 1000) / 1000,
  }));
  emit({ event: 'sources', data: sources });

  const base = { sources, topScore: allHits[0]?.score ?? null, retrievalMs, queryRewrite: search.rewrite };

  // Nothing relevant: answer "not found" without calling the model. Cheaper, and it can't hallucinate.
  if (hits.length === 0) {
    emit({ event: 'delta', data: { text: NOT_FOUND_ANSWER } });
    emit({ event: 'done', data: { cited: [], notFound: true, requestId: input.requestId } });
    return {
      ...base,
      answer: NOT_FOUND_ANSWER,
      cited: [],
      notFound: true,
      skippedModel: true,
      usage: search.usage,
      totalMs: performance.now() - started,
    };
  }

  let answer = '';
  let usage: TokenUsage | null = search.usage;
  const stream = answerer.stream({
    instructions: systemPrompt(settings.productName),
    input: [...cleanHistory(input.history), { role: 'user', content: userMessage(input.question, hits) }],
    signal: input.signal,
  });

  for await (const chunk of stream) {
    if (chunk.type === 'delta') {
      answer += chunk.text;
      emit({ event: 'delta', data: { text: chunk.text } });
    } else {
      usage = addUsage(usage, chunk.usage);
    }
  }

  const notFound = isNotFound(answer);
  const cited = notFound ? [] : citedSourceIds(answer, sources.length);
  emit({ event: 'done', data: { cited, notFound, requestId: input.requestId } });

  return { ...base, answer, cited, notFound, skippedModel: false, usage, totalMs: performance.now() - started };
}

export interface SearchQuery {
  query: string;
  rewrite: 'none' | 'model' | 'fallback';
  usage: TokenUsage | null;
}

const REWRITE_MAX_TOKENS = 256;

/**
 * A follow-up like "and on monthly plans?" retrieves badly on its own: it has no topic.
 * With history, a quick model call rewrites it into a standalone query. If that call
 * fails we fall back to a heuristic rather than failing the whole request.
 */
export async function buildSearchQuery(
  question: string,
  history: ChatTurn[],
  answerer: Answerer,
  signal: AbortSignal,
): Promise<SearchQuery> {
  if (history.length === 0) return { query: question, rewrite: 'none', usage: null };

  try {
    const { text, usage } = await answerer.complete({
      instructions: REWRITE_INSTRUCTIONS,
      input: [{ role: 'user', content: rewriteInput(history, question) }],
      maxOutputTokens: REWRITE_MAX_TOKENS,
      signal,
    });
    const query = text
      .trim()
      .replace(/^["'“]|["'”]$/g, '')
      .slice(0, CHAT_LIMITS.questionMaxChars);
    if (query) return { query, rewrite: 'model', usage };
  } catch (err) {
    if (signal.aborted) throw err;
  }
  return { query: fallbackSearchQuery(question, history), rewrite: 'fallback', usage: null };
}

/**
 * Without the model: prepend the most recent question that actually got an answer.
 * Skipping "not found" turns stops an off-topic question from hijacking the next one.
 */
export function fallbackSearchQuery(question: string, history: ChatTurn[]): string {
  for (let i = history.length - 1; i > 0; i--) {
    const answer = history[i];
    const asked = history[i - 1];
    if (answer.role === 'assistant' && asked.role === 'user' && !isNotFound(answer.content)) {
      return `${asked.content}\n${question}`;
    }
  }
  return question;
}

function addUsage(a: TokenUsage | null, b: TokenUsage): TokenUsage {
  return a ? { inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens } : b;
}
