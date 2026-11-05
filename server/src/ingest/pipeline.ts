import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Embedder } from '../llm/types.ts';
import type { Store } from '../store.ts';
import { chunkSections, embeddingInput } from './chunk.ts';
import { loadDocument, SUPPORTED_EXTENSIONS } from './loaders.ts';

export interface IngestSummary {
  indexed: { file: string; chunks: number; tokens: number }[];
  unchanged: string[];
  removed: string[];
  empty: string[];
  embeddingTokens: number;
}

/**
 * Indexes every supported file in `docsDir`:  file -> sections -> chunks -> embeddings -> store.
 *
 * Idempotent and incremental:
 *  - unchanged files are skipped (no embedding cost)
 *  - changed files are re-embedded and replaced atomically
 *  - files deleted from `docsDir` are removed from the index
 *  - changing the embedding model re-embeds everything, because vectors from
 *    different models live in different spaces and cannot be compared
 */
export async function ingestDirectory(options: {
  docsDir: string;
  store: Store;
  embedder: Embedder;
  onProgress?: (message: string) => void;
}): Promise<IngestSummary> {
  const { docsDir, store, embedder, onProgress = () => {} } = options;
  const summary: IngestSummary = { indexed: [], unchanged: [], removed: [], empty: [], embeddingTokens: 0 };

  const existing = store.documentVersions();
  const files = (await readdir(docsDir, { recursive: true }))
    .filter((file) => SUPPORTED_EXTENSIONS.has(path.extname(file).toLowerCase()))
    .map((file) => file.split(path.sep).join('/')) // stable ids across OSes
    .sort();

  for (const file of files) {
    const data = await readFile(path.join(docsDir, file));
    const hash = createHash('sha256').update(data).digest('hex');
    const previous = existing.get(file);

    if (previous && previous.hash === hash && previous.model === embedder.model) {
      summary.unchanged.push(file);
      continue;
    }

    const doc = await loadDocument(file, data);
    const chunks = chunkSections(doc.sections);
    if (chunks.length === 0) {
      summary.empty.push(file);
      onProgress(`⚠ ${file}: no extractable text, skipped`);
      continue;
    }

    const { vectors, tokens } = await embedder.embed(chunks.map((chunk) => embeddingInput(doc.title, chunk)));
    store.replaceDocument(
      { file, title: doc.title, hash, model: embedder.model },
      chunks.map((chunk, i) => ({ ...chunk, embedding: vectors[i] })),
    );

    summary.indexed.push({ file, chunks: chunks.length, tokens });
    summary.embeddingTokens += tokens;
    onProgress(`✓ ${file}: ${chunks.length} chunks, ${tokens} tokens`);
  }

  const current = new Set(files);
  for (const file of existing.keys()) {
    if (!current.has(file)) {
      store.deleteDocument(file);
      summary.removed.push(file);
      onProgress(`✗ ${file}: removed from index`);
    }
  }

  return summary;
}
