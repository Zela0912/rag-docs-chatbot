import { describe, expect, it } from 'vitest';
import { createSseParser, type SseMessage } from './sse.ts';

function parseAll(chunks: string[]): SseMessage[] {
  const out: SseMessage[] = [];
  const parser = createSseParser((m) => out.push(m));
  for (const chunk of chunks) parser.push(chunk);
  parser.flush();
  return out;
}

describe('createSseParser', () => {
  it('parses several events from one chunk', () => {
    expect(parseAll(['event: a\ndata: 1\n\nevent: b\ndata: 2\n\n'])).toEqual([
      { event: 'a', data: '1' },
      { event: 'b', data: '2' },
    ]);
  });

  it('reassembles an event split across arbitrary chunk boundaries', () => {
    const raw = 'event: delta\ndata: {"text":"Hello"}\n\n';
    const chunks = raw.split(''); // worst case: one character per chunk
    expect(parseAll(chunks)).toEqual([{ event: 'delta', data: '{"text":"Hello"}' }]);
  });

  it('joins multi-line data, skips comments and defaults the event name', () => {
    expect(parseAll([': keep-alive\n\ndata: line 1\ndata: line 2\n\n'])).toEqual([
      { event: 'message', data: 'line 1\nline 2' },
    ]);
  });

  it('handles CRLF line endings', () => {
    expect(parseAll(['event: a\r\ndata: 1\r\n\r\n'])).toEqual([{ event: 'a', data: '1' }]);
  });

  it('dispatches a final event without a trailing blank line on flush', () => {
    expect(parseAll(['event: done\ndata: {}'])).toEqual([{ event: 'done', data: '{}' }]);
  });
});
