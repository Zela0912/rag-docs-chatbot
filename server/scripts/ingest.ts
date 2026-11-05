/**
 * Indexes everything in data/docs:  file -> sections -> chunks -> embeddings -> SQLite.
 * Safe to re-run: unchanged files are skipped (no embedding cost), changed files are
 * re-embedded, and files that were deleted from data/docs are removed from the index.
 */
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../src/config.ts';
import { chunkSections, embeddingInput } from '../src/ingest/chunk.ts';
import { SUPPORTED_EXTENSIONS, loadDocument } from '../src/ingest/loaders.ts';
import { embed } from '../src/openai.ts';
import { Store } from '../src/store.ts';

const store = new Store(config.dbPath);
const existing = store.documentVersions();

const files = (await readdir(config.docsDir, { recursive: true }))
  .filter((f) => SUPPORTED_EXTENSIONS.has(path.extname(f).toLowerCase()))
  .sort();

if (files.length === 0) {
  console.log(`No supported files in ${config.docsDir}`);
}

let indexed = 0;
let skipped = 0;
let totalTokens = 0;

for (const file of files) {
  const data = await readFile(path.join(config.docsDir, file));
  const hash = createHash('sha256').update(data).digest('hex');
  const previous = existing.get(file);

  // Vectors from different embedding models are not comparable, so a model change forces a re-embed.
  if (previous && previous.hash === hash && previous.model === config.embeddingModel) {
    skipped++;
    continue;
  }

  const doc = await loadDocument(file, data);
  const chunks = chunkSections(doc.sections);
  if (chunks.length === 0) {
    console.warn(`⚠ ${file}: no text found, skipped`);
    continue;
  }

  const { vectors, tokens } = await embed(chunks.map((c) => embeddingInput(doc.title, c)));
  store.replaceDocument(
    { file, title: doc.title, hash, model: config.embeddingModel },
    chunks.map((c, i) => ({ ...c, embedding: vectors[i] })),
  );

  totalTokens += tokens;
  indexed++;
  console.log(`✓ ${file}: ${chunks.length} chunks, ${tokens} tokens`);
}

for (const file of existing.keys()) {
  if (!files.includes(file)) {
    store.deleteDocument(file);
    console.log(`✗ ${file}: removed from index`);
  }
}

store.close();
console.log(`\nDone. Indexed ${indexed}, unchanged ${skipped}, embedding tokens used: ${totalTokens}.`);
