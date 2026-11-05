import { describe, expect, it } from 'vitest';
import {
  citedSourceIds,
  cleanHistory,
  isNotFound,
  NOT_FOUND_ANSWER,
  systemPrompt,
  userMessage,
} from '../src/prompt.ts';
import type { Hit } from '../src/retrieve.ts';

const hit = (title: string, location: string, text: string): Hit => ({
  id: 1,
  file: 'f.md',
  title,
  location,
  text,
  score: 0.5,
  embedding: new Float32Array(),
});

describe('citedSourceIds', () => {
  it('reads [n], [n][m] and [n, m] forms, de-duplicated and sorted', () => {
    expect(citedSourceIds('Yes [2]. Also [1][3] and [3, 1].', 5)).toEqual([1, 2, 3]);
  });

  it('ignores numbers that do not refer to a real source', () => {
    expect(citedSourceIds('See [0] and [9].', 3)).toEqual([]);
  });
});

describe('cleanHistory', () => {
  it('strips old citation markers from assistant turns only', () => {
    expect(
      cleanHistory([
        { role: 'user', content: 'What about [1]?' },
        { role: 'assistant', content: 'It costs $4 [1][2]. Refunds within 30 days [3, 4].' },
      ]),
    ).toEqual([
      { role: 'user', content: 'What about [1]?' },
      { role: 'assistant', content: 'It costs $4. Refunds within 30 days.' },
    ]);
  });
});

describe('userMessage', () => {
  it('numbers sources and escapes attribute values', () => {
    const message = userMessage('How much?', [hit('Plans "2026"', 'Pricing & tiers', 'It costs $4.')]);
    expect(message).toContain('<source id="1" document="Plans &quot;2026&quot;" section="Pricing &amp; tiers">');
    expect(message).toContain('It costs $4.');
    expect(message.endsWith('Question: How much?')).toBe(true);
  });
});

describe('systemPrompt', () => {
  it('names the product and embeds the exact not-found sentence', () => {
    const prompt = systemPrompt('TidyShift');
    expect(prompt).toContain('TidyShift');
    expect(prompt).toContain(NOT_FOUND_ANSWER);
  });
});

describe('isNotFound', () => {
  it('matches the refusal sentence regardless of surrounding whitespace', () => {
    expect(isNotFound(`  ${NOT_FOUND_ANSWER}\n`)).toBe(true);
    expect(isNotFound('Annual plans can be refunded within 30 days [1].')).toBe(false);
  });
});
