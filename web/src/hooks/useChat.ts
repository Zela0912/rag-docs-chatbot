import { useCallback, useEffect, useRef, useState } from 'react';
import { CHAT_LIMITS, type ChatTurn, type Source } from '../../../shared/chat-protocol.ts';
import { ChatApiError, streamChat } from '../api/chatClient.ts';

export type AssistantStatus = 'searching' | 'streaming' | 'done' | 'stopped' | 'error';

export interface UserMessage {
  id: string;
  role: 'user';
  content: string;
}

export interface AssistantMessage {
  id: string;
  role: 'assistant';
  content: string;
  sources: Source[];
  cited: number[];
  notFound: boolean;
  status: AssistantStatus;
  error?: string;
  requestId?: string;
}

export type Message = UserMessage | AssistantMessage;

/** How many previous turns we send for context. More turns = better follow-ups, higher cost. */
const HISTORY_TURNS = 6;

let nextId = 0;
const newId = () => `m${++nextId}`;

/**
 * All chat state and the streaming lifecycle in one place, so components only render.
 * One request at a time: `send` is ignored while an answer is in progress.
 */
export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const messagesRef = useRef(messages);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Abort any in-flight request on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  const start = useCallback((question: string, prior: Message[]) => {
    const userMessage: UserMessage = { id: newId(), role: 'user', content: question };
    const assistantId = newId();
    const next: Message[] = [
      ...prior,
      userMessage,
      { id: assistantId, role: 'assistant', content: '', sources: [], cited: [], notFound: false, status: 'searching' },
    ];
    messagesRef.current = next;
    setMessages(next);

    const update = (patch: (message: AssistantMessage) => AssistantMessage) =>
      setMessages((current) => current.map((m) => (m.id === assistantId && m.role === 'assistant' ? patch(m) : m)));

    const controller = new AbortController();
    abortRef.current = controller;
    let settled = false;

    streamChat(
      { question, history: toHistory(prior) },
      {
        signal: controller.signal,
        onEvent: (event) => {
          switch (event.event) {
            case 'sources':
              update((m) => ({ ...m, sources: event.data }));
              break;
            case 'delta':
              update((m) => ({ ...m, status: 'streaming', content: m.content + event.data.text }));
              break;
            case 'done':
              settled = true;
              update((m) => ({
                ...m,
                status: 'done',
                cited: event.data.cited,
                notFound: event.data.notFound,
                requestId: event.data.requestId,
              }));
              break;
            case 'error':
              settled = true;
              update((m) => ({ ...m, status: 'error', error: event.data.message, requestId: event.data.requestId }));
              break;
          }
        },
      },
    )
      .then(() => {
        if (!settled)
          update((m) => ({ ...m, status: 'error', error: 'The answer was interrupted. Please try again.' }));
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) {
          update((m) => ({ ...m, status: 'stopped' }));
        } else {
          const message = err instanceof ChatApiError ? err.message : 'Something went wrong. Please try again.';
          update((m) => ({ ...m, status: 'error', error: message }));
        }
      })
      .finally(() => {
        if (abortRef.current === controller) abortRef.current = null;
      });
  }, []);

  const send = useCallback(
    (raw: string) => {
      const question = raw.trim().slice(0, CHAT_LIMITS.questionMaxChars);
      if (!question || abortRef.current) return;
      start(question, messagesRef.current);
    },
    [start],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  /** Re-ask the question behind a failed or stopped answer, in place. */
  const retry = useCallback(
    (assistantId: string) => {
      if (abortRef.current) return;
      const current = messagesRef.current;
      const index = current.findIndex((m) => m.id === assistantId);
      if (index < 1) return;
      const question = current[index - 1];
      if (question.role !== 'user') return;
      start(question.content, current.slice(0, index - 1));
    },
    [start],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    messagesRef.current = [];
    setMessages([]);
  }, []);

  const isBusy = messages.some((m) => m.role === 'assistant' && (m.status === 'searching' || m.status === 'streaming'));

  return { messages, isBusy, send, stop, retry, reset };
}

/** Completed question/answer pairs only; failed or stopped turns would just confuse the model. */
export function toHistory(messages: Message[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (let i = 1; i < messages.length; i++) {
    const question = messages[i - 1];
    const answer = messages[i];
    if (question.role === 'user' && answer.role === 'assistant' && answer.status === 'done') {
      turns.push(
        { role: 'user', content: question.content.slice(0, CHAT_LIMITS.turnMaxChars) },
        { role: 'assistant', content: answer.content.slice(0, CHAT_LIMITS.turnMaxChars) },
      );
    }
  }
  return turns.slice(-HISTORY_TURNS);
}
