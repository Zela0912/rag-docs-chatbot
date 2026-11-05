import { describe, expect, it } from 'vitest';
import { buildSearchQuery, fallbackSearchQuery } from '../src/chat/service.ts';
import { NOT_FOUND_ANSWER } from '../src/prompt.ts';
import { fakeAnswerer, textChunks } from './helpers.ts';

const signal = new AbortController().signal;
const history = [
  { role: 'user', content: 'Can I get a refund on an annual plan?' },
  { role: 'assistant', content: 'Yes, within 30 days [1].' },
] as const;

describe('buildSearchQuery', () => {
  it('uses the question as-is when there is no history, without a model call', async () => {
    const answerer = fakeAnswerer(() => textChunks());
    const result = await buildSearchQuery('Where is data stored?', [], answerer, signal);
    expect(result).toEqual({ query: 'Where is data stored?', rewrite: 'none', usage: null });
    expect(answerer.completions).toHaveLength(0);
  });

  it('asks the model to rewrite a follow-up into a standalone query', async () => {
    const answerer = fakeAnswerer(
      () => textChunks(),
      () => '"Can I get a refund on a monthly plan?"',
    );
    const result = await buildSearchQuery('And monthly?', [...history], answerer, signal);

    expect(result.query).toBe('Can I get a refund on a monthly plan?'); // surrounding quotes stripped
    expect(result.rewrite).toBe('model');
    const prompt = answerer.completions[0].input[0].content;
    expect(prompt).toContain('User: Can I get a refund on an annual plan?');
    expect(prompt).toContain('Assistant: Yes, within 30 days.'); // old citation markers removed
    expect(prompt).toContain('Latest message: And monthly?');
  });

  it('falls back to the heuristic when the rewrite call fails', async () => {
    const answerer = fakeAnswerer(
      () => textChunks(),
      () => {
        throw new Error('rate limited');
      },
    );
    const result = await buildSearchQuery('And monthly?', [...history], answerer, signal);
    expect(result).toEqual({
      query: 'Can I get a refund on an annual plan?\nAnd monthly?',
      rewrite: 'fallback',
      usage: null,
    });
  });

  it('falls back when the model returns an empty rewrite', async () => {
    const answerer = fakeAnswerer(
      () => textChunks(),
      () => '   ',
    );
    expect((await buildSearchQuery('And monthly?', [...history], answerer, signal)).rewrite).toBe('fallback');
  });
});

describe('fallbackSearchQuery', () => {
  it('skips turns the assistant could not answer, so off-topic questions do not hijack the next one', () => {
    expect(
      fallbackSearchQuery('And what about monthly plans?', [
        ...history,
        { role: 'user', content: 'What is the capital of France?' },
        { role: 'assistant', content: NOT_FOUND_ANSWER },
      ]),
    ).toBe('Can I get a refund on an annual plan?\nAnd what about monthly plans?');
  });

  it('returns the question unchanged when nothing earlier was answered', () => {
    expect(fallbackSearchQuery('Refunds?', [])).toBe('Refunds?');
  });
});
