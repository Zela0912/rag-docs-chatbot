import { describe, expect, it } from 'vitest';
import { Retriever, reciprocalRankFusion } from '../src/retrieve.ts';
import { Store, toMatchQuery } from '../src/store.ts';
import { fakeEmbedder, seededRetriever } from './helpers.ts';

describe('reciprocalRankFusion', () => {
  it('rewards items ranked well by several lists', () => {
    // 2 is second in both lists, so it beats 1 and 3, which each top only one list.
    expect(
      reciprocalRankFusion([
        [1, 2, 4],
        [3, 2, 5],
      ])[0],
    ).toBe(2);
  });

  it('includes items found by only one method', () => {
    expect(reciprocalRankFusion([[1], [9]]).sort()).toEqual([1, 9]);
  });

  it('lets a lower weight make one list a tie-breaker rather than an equal vote', () => {
    expect(
      reciprocalRankFusion(
        [
          [1, 2],
          [2, 1],
        ],
        [1, 0.3],
      ),
    ).toEqual([1, 2]);
  });
});

describe('toMatchQuery', () => {
  it('quotes words and drops stopwords', () => {
    expect(toMatchQuery('How long is the free trial?')).toBe('"long" OR "free" OR "trial"');
  });

  it('neutralises FTS5 operators in user input', () => {
    expect(toMatchQuery('refund* NEAR(billing) "x" OR -invoice')).toBe('"refund" OR "near" OR "billing" OR "invoice"');
  });

  it('keeps non-English words, so Croatian questions still match', () => {
    expect(toMatchQuery('Koliko košta Starter plan?')).toBe('"koliko" OR "košta" OR "starter" OR "plan"');
  });

  it('returns null when nothing searchable is left', () => {
    expect(toMatchQuery('how do I?')).toBeNull();
  });
});

describe('Store keyword index', () => {
  const vec = Float32Array.from([1, 0]);

  it('finds chunks by exact terms, ignoring diacritics', () => {
    const store = new Store(':memory:');
    store.replaceDocument({ file: 'a.md', title: 'Cjenik', hash: 'h', model: 'm' }, [
      { location: 'Planovi', text: 'Starter plan košta 4 dolara.', embedding: vec },
      { location: 'Ostalo', text: 'Nešto sasvim drugo.', embedding: vec },
    ]);
    const [first] = store.allChunks();
    expect(store.keywordSearch('koliko kosta starter', 5)).toEqual([first.id]);
  });

  it('removes keyword entries when a document is replaced or deleted', () => {
    const store = new Store(':memory:');
    const doc = { file: 'a.md', title: 'A', hash: 'h', model: 'm' };
    store.replaceDocument(doc, [{ location: 'L', text: 'refund policy', embedding: vec }]);
    store.replaceDocument(doc, [{ location: 'L', text: 'shipping policy', embedding: vec }]);
    expect(store.keywordSearch('refund', 5)).toEqual([]);
    expect(store.keywordSearch('shipping', 5)).toHaveLength(1);

    store.deleteDocument('a.md');
    expect(store.keywordSearch('shipping', 5)).toEqual([]);
  });
});

describe('Retriever (hybrid)', () => {
  it('surfaces an exact-term match that vector similarity ranks low', async () => {
    const docs = [
      {
        file: 'a.md',
        title: 'Billing',
        chunks: [
          { location: 'Cards', text: 'Billing billing billing payment payment card card' },
          { location: 'Misc', text: 'Billing payment card details' },
          { location: 'Signup', text: 'Every workspace starts with a zyxtrial period' },
        ],
      },
    ];
    const embedder = fakeEmbedder();
    const { store } = await seededRetriever(docs, embedder);

    const vectorOnly = await new Retriever(store, embedder, { hybrid: false }).search('billing payment zyxtrial', 2);
    const hybrid = await new Retriever(store, embedder, { hybrid: true, keywordWeight: 1 }).search(
      'billing payment zyxtrial',
      2,
    );

    expect(vectorOnly.map((h) => h.location)).not.toContain('Signup');
    expect(hybrid.map((h) => h.location)).toContain('Signup');
  });
});
