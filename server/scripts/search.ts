/**
 * npm run search -- "your question"
 *
 * Debugging aid: shows what retrieval returns for a question (score, document, section)
 * without calling the chat model. First thing to check when an answer looks wrong.
 */
import OpenAI from 'openai';
import { loadConfig } from '../src/config.ts';
import { createOpenAIEmbedder } from '../src/llm/openai.ts';
import { Retriever } from '../src/retrieve.ts';
import { Store } from '../src/store.ts';

const question = process.argv.slice(2).join(' ').trim();
if (!question) {
  console.error('Usage: npm run search -- "How do I get a refund?"');
  process.exit(1);
}

const config = loadConfig();
const store = new Store(config.dbPath);
const embedder = createOpenAIEmbedder(new OpenAI({ apiKey: config.openaiApiKey }), config.embeddingModel);
const retriever = new Retriever(store, embedder, { hybrid: config.hybridSearch });

const hits = await retriever.search(question, 10);
console.log(
  `\n"${question}"  (${config.hybridSearch ? 'hybrid' : 'vector-only'}, MIN_SCORE=${config.minScore}, TOP_K=${config.topK})\n`,
);
hits.forEach((hit, i) => {
  const used = i < config.topK && hit.score >= config.minScore ? '●' : '○';
  console.log(`${used} ${hit.score.toFixed(3)}  ${hit.file} › ${hit.location}`);
});
console.log('\n● = would be sent to the chat model');
store.close();
