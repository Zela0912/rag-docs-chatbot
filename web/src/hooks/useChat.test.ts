import { describe, expect, it } from 'vitest';
import { type Message, toHistory } from './useChat.ts';

const user = (id: string, content: string): Message => ({ id, role: 'user', content });
const assistant = (id: string, content: string, status: 'done' | 'error' | 'stopped' = 'done'): Message => ({
  id,
  role: 'assistant',
  content,
  status,
  sources: [],
  cited: [],
  notFound: false,
});

describe('toHistory', () => {
  it('keeps completed question/answer pairs in order', () => {
    expect(toHistory([user('1', 'Q1'), assistant('2', 'A1'), user('3', 'Q2'), assistant('4', 'A2')])).toEqual([
      { role: 'user', content: 'Q1' },
      { role: 'assistant', content: 'A1' },
      { role: 'user', content: 'Q2' },
      { role: 'assistant', content: 'A2' },
    ]);
  });

  it('drops failed and stopped turns', () => {
    expect(
      toHistory([user('1', 'Q1'), assistant('2', '', 'error'), user('3', 'Q2'), assistant('4', 'half', 'stopped')]),
    ).toEqual([]);
  });

  it('keeps only the most recent turns', () => {
    const many = Array.from({ length: 10 }, (_, i) => [user(`u${i}`, `Q${i}`), assistant(`a${i}`, `A${i}`)]).flat();
    const history = toHistory(many);
    expect(history).toHaveLength(6);
    expect(history[0]).toEqual({ role: 'user', content: 'Q7' });
  });
});
