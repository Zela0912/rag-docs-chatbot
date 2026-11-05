export interface SseMessage {
  event: string;
  data: string;
}

/**
 * Incremental Server-Sent Events parser.
 *
 * The browser's EventSource only supports GET, and our chat endpoint is a POST with a JSON
 * body, so we read the fetch() body stream ourselves. Network chunks don't line up with
 * events, which is why this buffers until it sees the blank line that ends each event.
 */
export function createSseParser(onMessage: (message: SseMessage) => void) {
  let buffer = '';

  const dispatch = (block: string) => {
    let event = 'message';
    const data: string[] = [];

    for (const line of block.split('\n')) {
      if (line === '' || line.startsWith(':')) continue; // ":" lines are comments/keep-alives
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);

      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }

    if (data.length > 0) onMessage({ event, data: data.join('\n') });
  };

  return {
    push(chunk: string) {
      buffer = (buffer + chunk).replace(/\r\n?/g, '\n');
      for (let end = buffer.indexOf('\n\n'); end !== -1; end = buffer.indexOf('\n\n')) {
        dispatch(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
      }
    },
    /** Call when the stream ends, in case the last event had no trailing blank line. */
    flush() {
      if (buffer.trim()) dispatch(buffer);
      buffer = '';
    },
  };
}
