import { describe, expect, it } from 'vitest';
import { chunkSections, embeddingInput } from '../src/ingest/chunk.ts';

describe('chunkSections', () => {
  it('keeps a short section as a single chunk', () => {
    const chunks = chunkSections([{ location: 'Refunds', text: 'Annual plans can be refunded within 30 days.' }]);
    expect(chunks).toEqual([{ location: 'Refunds', text: 'Annual plans can be refunded within 30 days.' }]);
  });

  it('splits a long section on paragraph boundaries and keeps every chunk within bounds', () => {
    const paragraph = 'Sentence about refunds and billing details. '.repeat(20).trim();
    const chunks = chunkSections([{ location: 'Billing', text: Array(6).fill(paragraph).join('\n\n') }]);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.location).toBe('Billing');
      expect(chunk.text.length).toBeLessThanOrEqual(1500 + 200 + 2); // max + overlap + separator
    }
  });

  it('overlaps consecutive chunks so boundary sentences stay findable', () => {
    const paragraphs = Array.from({ length: 4 }, (_, i) => `Paragraph ${i} ${'word '.repeat(150)}end${i}.`);
    const [first, second] = chunkSections([{ location: 'X', text: paragraphs.join('\n\n') }]);
    const tailOfFirst = first.text.slice(-50);
    expect(second.text).toContain(tailOfFirst.slice(tailOfFirst.indexOf(' ') + 1));
  });

  it('hard-splits a single sentence longer than the limit', () => {
    const chunks = chunkSections([{ location: 'X', text: 'a'.repeat(4000) }]);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks.map((c) => c.text).join('')).toContain('a'.repeat(1500));
  });
});

describe('embeddingInput', () => {
  it('prefixes the document title and section so short chunks keep their context', () => {
    expect(embeddingInput('Plans and Pricing', { location: 'Plans', text: '$4 per user' })).toBe(
      'Plans and Pricing\nPlans\n\n$4 per user',
    );
  });
});
