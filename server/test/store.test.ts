import { describe, expect, it } from 'vitest';
import { cosineSimilarity } from '../src/retrieve.ts';
import { Store } from '../src/store.ts';

const vec = (...values: number[]) => Float32Array.from(values);

describe('Store', () => {
  it('round-trips chunks and their embeddings', () => {
    const store = new Store(':memory:');
    store.replaceDocument({ file: 'a.md', title: 'A', hash: 'h1', model: 'm' }, [
      { location: 'One', text: 'first', embedding: vec(0.1, -0.2, 0.3) },
      { location: 'Two', text: 'second', embedding: vec(1, 0, 0) },
    ]);

    const chunks = store.allChunks();
    expect(chunks.map((c) => [c.file, c.title, c.location, c.text])).toEqual([
      ['a.md', 'A', 'One', 'first'],
      ['a.md', 'A', 'Two', 'second'],
    ]);
    expect(Array.from(chunks[0].embedding)).toEqual(Array.from(vec(0.1, -0.2, 0.3)));
  });

  it('replaces a document atomically instead of appending duplicates', () => {
    const store = new Store(':memory:');
    const doc = { file: 'a.md', title: 'A', model: 'm' };
    store.replaceDocument({ ...doc, hash: 'h1' }, [{ location: 'L', text: 'old', embedding: vec(1) }]);
    store.replaceDocument({ ...doc, hash: 'h2' }, [{ location: 'L', text: 'new', embedding: vec(1) }]);

    expect(store.allChunks().map((c) => c.text)).toEqual(['new']);
    expect(store.documentVersions().get('a.md')).toEqual({ hash: 'h2', model: 'm' });
  });

  it('deletes a document together with its chunks', () => {
    const store = new Store(':memory:');
    store.replaceDocument({ file: 'a.md', title: 'A', hash: 'h', model: 'm' }, [
      { location: 'L', text: 't', embedding: vec(1) },
    ]);
    store.deleteDocument('a.md');
    expect(store.allChunks()).toEqual([]);
    expect(store.documentVersions().size).toBe(0);
  });
});

describe('cosineSimilarity', () => {
  it('is 1 for identical direction, 0 for orthogonal, -1 for opposite', () => {
    expect(cosineSimilarity(vec(1, 2), vec(2, 4))).toBeCloseTo(1);
    expect(cosineSimilarity(vec(1, 0), vec(0, 1))).toBeCloseTo(0);
    expect(cosineSimilarity(vec(1, 0), vec(-1, 0))).toBeCloseTo(-1);
  });

  it('returns 0 for a zero vector instead of NaN', () => {
    expect(cosineSimilarity(vec(0, 0), vec(1, 1))).toBe(0);
  });

  it('fails loudly when vectors come from different models', () => {
    expect(() => cosineSimilarity(vec(1, 2), vec(1, 2, 3))).toThrow('Vector length mismatch');
  });
});
