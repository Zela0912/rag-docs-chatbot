/**
 * npm run ingest — index everything in data/docs. Safe to re-run at any time;
 * see src/ingest/pipeline.ts for how unchanged and deleted files are handled.
 */
import OpenAI from 'openai';
import { loadConfig } from '../src/config.ts';
import { ingestDirectory } from '../src/ingest/pipeline.ts';
import { createOpenAIEmbedder } from '../src/llm/openai.ts';
import { Store } from '../src/store.ts';

const config = loadConfig();
const store = new Store(config.dbPath);
const embedder = createOpenAIEmbedder(new OpenAI({ apiKey: config.openaiApiKey }), config.embeddingModel);

try {
  const summary = await ingestDirectory({ docsDir: config.docsDir, store, embedder, onProgress: console.log });
  console.log(
    `\nDone. Indexed ${summary.indexed.length}, unchanged ${summary.unchanged.length}, ` +
      `removed ${summary.removed.length}. Embedding tokens used: ${summary.embeddingTokens}.`,
  );
} finally {
  store.close();
}
