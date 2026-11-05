/**
 * The contract between server and web client for POST /api/chat.
 * Both sides import this file, so a protocol change is a compile error on both ends.
 */

export const CHAT_LIMITS = {
  questionMaxChars: 2000,
  historyMaxTurns: 10,
  turnMaxChars: 4000,
} as const;

export type Role = 'user' | 'assistant';

export interface ChatTurn {
  role: Role;
  content: string;
}

export interface ChatRequestBody {
  question: string;
  /** Previous turns, oldest first. Lets follow-up questions make sense. */
  history?: ChatTurn[];
}

/** A retrieved chunk the answer may cite as [id]. */
export interface Source {
  id: number;
  document: string;
  file: string;
  location: string;
  text: string;
  /** Cosine similarity between the question and this chunk, 0-1. */
  score: number;
}

export interface DonePayload {
  /** Source ids the answer actually cited. */
  cited: number[];
  /** True when the assistant could not answer from the docs. */
  notFound: boolean;
  requestId: string;
}

export interface ErrorPayload {
  message: string;
  requestId: string;
}

/**
 * Server-Sent Events, in order:
 *   sources (once) -> delta (0..n) -> done | error
 */
export type ChatEvent =
  | { event: 'sources'; data: Source[] }
  | { event: 'delta'; data: { text: string } }
  | { event: 'done'; data: DonePayload }
  | { event: 'error'; data: ErrorPayload };

/** JSON body of non-streaming error responses (400, 429, 500). */
export interface ApiErrorBody {
  error: string;
}
