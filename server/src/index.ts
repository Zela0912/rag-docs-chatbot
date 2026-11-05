import OpenAI from 'openai';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createOpenAIAnswerer, createOpenAIEmbedder } from './llm/openai.ts';
import { createJsonLogger } from './logger.ts';
import { Retriever } from './retrieve.ts';
import { Store } from './store.ts';

const config = loadConfig();
const logger = createJsonLogger();

const openai = new OpenAI({ apiKey: config.openaiApiKey, maxRetries: 2, timeout: 60_000 });
const store = new Store(config.dbPath);
const retriever = new Retriever(store, createOpenAIEmbedder(openai, config.embeddingModel), {
  hybrid: config.hybridSearch,
});
const answerer = createOpenAIAnswerer(openai, config.chatModel, { maxOutputTokens: config.maxOutputTokens });

if (retriever.size === 0) {
  logger.warn('index.empty', { hint: 'Run `npm run ingest` to index data/docs.' });
}

const app = createApp({
  retriever,
  answerer,
  settings: { topK: config.topK, minScore: config.minScore, productName: config.productName },
  logger,
  rateLimitPerMinute: config.rateLimitPerMinute,
  trustProxy: config.trustProxy,
  webDistDir: config.webDistDir,
});

const server = app.listen(config.port, () => {
  logger.info('server.started', {
    url: `http://localhost:${config.port}`,
    chunks: retriever.size,
    chatModel: config.chatModel,
    embeddingModel: config.embeddingModel,
    hybridSearch: config.hybridSearch,
  });
});

// Let in-flight answers finish when the platform stops the container.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info('server.stopping', { signal });
    server.close(() => {
      store.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
