import type { ChatEvent, Source } from '../../../shared/chat-protocol.ts';

export const SOURCES: Source[] = [
  {
    id: 1,
    document: 'Billing and Refunds',
    file: 'billing-and-refunds.md',
    location: 'Refunds',
    text: 'Annual plans: you can request a full refund within 30 days of the initial purchase or the renewal date.',
    score: 0.587,
  },
  {
    id: 2,
    document: 'Plans and Pricing',
    file: 'plans-and-pricing.md',
    location: 'Annual billing',
    text: 'Paying annually gives a 20% discount on Starter and Pro.',
    score: 0.498,
  },
];

export function encodeEvents(events: ChatEvent[]): string {
  return events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join('');
}

/** A streaming Response that delivers `body` in small chunks, like a real network would. */
export function sseResponse(body: string, chunkSize = 17): Response {
  const bytes = new TextEncoder().encode(body);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

/** A Response that never finishes until the request is aborted. */
export function hangingSseResponse(signal: AbortSignal | null | undefined, first: ChatEvent[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(encodeEvents(first)));
      signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

export const answerEvents = (text: string[], cited: number[]): ChatEvent[] => [
  { event: 'sources', data: SOURCES },
  ...text.map((t) => ({ event: 'delta', data: { text: t } }) as const),
  { event: 'done', data: { cited, notFound: false, requestId: 'req-1' } },
];
