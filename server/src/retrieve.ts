import type { Embedder } from './llm/types.ts';
import type { Store, StoredChunk } from './store.ts';

export interface Hit extends StoredChunk {
  /** Cosine similarity to the question (0-1). Used for the relevance threshold and shown in the UI. */
  score: number;
}

export interface RetrieverOptions {
  /**
   * Combine vector search with BM25 keyword search. Vectors understand meaning
   * ("money back" ≈ "refund"); keywords catch exact terms the embedding blurs
   * (plan names, "free trial", error codes). Default: true.
   */
  hybrid?: boolean;
  /**
   * Weight of the keyword ranking relative to the vector ranking in fusion. Below 1, keywords
   * mostly rescue chunks the vectors missed instead of reshuffling the top results.
   * 0.3 scored best on data/eval (recall@5 97% -> 100%, rank-1 accuracy unchanged at 90%).
   */
  keywordWeight?: number;
}

/** How many candidates each method contributes before fusion. */
const CANDIDATES = 20;
/** Standard RRF constant: dampens the advantage of being ranked #1 by a single method. */
const RRF_K = 60;

/**
 * Brute-force vector search over chunks held in memory, optionally fused with keyword search.
 * For a few thousand chunks this takes milliseconds and needs no extra infrastructure.
 */
export class Retriever {
  private readonly store: Store;
  private readonly embedder: Embedder;
  private readonly hybrid: boolean;
  private readonly keywordWeight: number;
  private chunks: StoredChunk[] = [];

  constructor(store: Store, embedder: Embedder, options: RetrieverOptions = {}) {
    this.store = store;
    this.embedder = embedder;
    this.hybrid = options.hybrid ?? true;
    this.keywordWeight = options.keywordWeight ?? 0.3;
    this.reload();
  }

  get size(): number {
    return this.chunks.length;
  }

  reload(): void {
    this.chunks = this.store.allChunks();
  }

  /** Top-k chunks, best first. Does not apply the relevance threshold; the caller decides. */
  async search(query: string, k: number): Promise<Hit[]> {
    if (this.chunks.length === 0) return [];
    const { vectors } = await this.embedder.embed([query]);
    const q = vectors[0];

    const byVector = this.chunks
      .map((chunk) => ({ ...chunk, score: cosineSimilarity(q, chunk.embedding) }))
      .sort((a, b) => b.score - a.score);

    if (!this.hybrid) return byVector.slice(0, k);

    const byId = new Map(byVector.map((hit) => [hit.id, hit]));
    const fused = reciprocalRankFusion(
      [byVector.slice(0, CANDIDATES).map((hit) => hit.id), this.store.keywordSearch(query, CANDIDATES)],
      [1, this.keywordWeight],
    );

    return fused.slice(0, k).flatMap((id) => byId.get(id) ?? []);
  }
}

/**
 * Reciprocal Rank Fusion: merge ranked lists by summing weight / (RRF_K + rank).
 * It only looks at ranks, so it can mix scores on different scales (cosine 0-1 vs.
 * unbounded BM25) without normalising them. Returns ids, best first.
 */
export function reciprocalRankFusion(rankings: number[][], weights: number[] = []): number[] {
  const scores = new Map<number, number>();
  for (const [r, ranking] of rankings.entries()) {
    const weight = weights[r] ?? 1;
    ranking.forEach((id, index) => {
      scores.set(id, (scores.get(id) ?? 0) + weight / (RRF_K + index + 1));
    });
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch (${a.length} vs ${b.length}). Was the index built with another model?`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
