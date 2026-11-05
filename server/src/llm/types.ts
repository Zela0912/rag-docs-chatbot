import type { ChatTurn } from '../../../shared/chat-protocol.ts';

/**
 * The app depends on these two small interfaces, not on the OpenAI SDK directly.
 * That keeps the provider swappable (Claude, Azure OpenAI, a local model) and lets
 * tests run the whole pipeline with fakes, offline and for free.
 */

export interface Embedder {
  readonly model: string;
  embed(texts: string[]): Promise<{ vectors: Float32Array[]; tokens: number }>;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export type AnswerChunk = { type: 'delta'; text: string } | { type: 'usage'; usage: TokenUsage };

export interface AnswerRequest {
  instructions: string;
  input: ChatTurn[];
  signal: AbortSignal;
}

export interface Answerer {
  readonly model: string;
  /** Streams an answer token by token. */
  stream(request: AnswerRequest): AsyncIterable<AnswerChunk>;
  /** One short, non-streamed completion (used to rewrite follow-up questions). */
  complete(request: AnswerRequest & { maxOutputTokens: number }): Promise<{ text: string; usage: TokenUsage | null }>;
}
