import type { ApiErrorBody, ChatEvent, ChatRequestBody } from '../../../shared/chat-protocol.ts';
import { createSseParser } from './sse.ts';

/** An error with a message that is safe and useful to show to the user. */
export class ChatApiError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ChatApiError';
    this.status = status;
  }
}

const GENERIC_ERROR = 'Something went wrong. Please try again.';

/**
 * Sends a question and calls `onEvent` for each streamed event as it arrives.
 * Resolves when the stream ends; rejects with ChatApiError (or an AbortError when cancelled).
 */
export async function streamChat(
  body: ChatRequestBody,
  options: { onEvent: (event: ChatEvent) => void; signal?: AbortSignal },
): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } catch (err) {
    if (options.signal?.aborted) throw err;
    throw new ChatApiError("Can't reach the assistant. Check your connection and try again.");
  }

  if (!res.ok || !res.headers.get('content-type')?.includes('text/event-stream')) {
    throw new ChatApiError(await readErrorMessage(res), res.status);
  }
  if (!res.body) throw new ChatApiError(GENERIC_ERROR, res.status);

  const parser = createSseParser(({ event, data }) => {
    options.onEvent({ event, data: JSON.parse(data) } as ChatEvent);
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.push(decoder.decode());
  parser.flush();
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as Partial<ApiErrorBody>;
    if (typeof body.error === 'string' && body.error) return body.error;
  } catch {
    // Not JSON (e.g. a proxy error page); fall through to the generic message.
  }
  return GENERIC_ERROR;
}
