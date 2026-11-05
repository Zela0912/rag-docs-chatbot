import { embed } from './openai.ts';
import type { Store, StoredChunk } from './store.ts';

export interface Hit extends StoredChunk {
  score: number;
}

/**
 * Brute-force vector search: compare the question against every chunk in memory.
 * For a few thousand chunks this takes milliseconds, and there is no extra database to run.
 */
export class Retriever {
  private store: Store;
  private chunks: StoredChunk[] = [];

  constructor(store: Store) {
    this.store = store;
    this.reload();
  }

  get size(): number {
    return this.chunks.length;
  }

  reload(): void {
    this.chunks = this.store.allChunks();
  }

  async search(query: string, k: number): Promise<Hit[]> {
    if (this.chunks.length === 0) return [];
    const { vectors } = await embed([query]);
    const q = vectors[0];

    return this.chunks
      .map((chunk) => ({ ...chunk, score: cosine(q, chunk.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
