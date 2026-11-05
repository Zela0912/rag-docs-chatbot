import path from 'node:path';
import { z } from 'zod';

// Project root (docs-chatbot/), so relative paths work no matter where a script is started from.
const ROOT = path.resolve(import.meta.dirname, '../..');

const EnvSchema = z.object({
  OPENAI_API_KEY: z.string({ error: 'is required. Copy .env.example to .env and add your key.' }).min(1),
  CHAT_MODEL: z.string().default('gpt-6-luna'),
  EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  /** How many chunks are handed to the model per question. */
  TOP_K: z.coerce.number().int().min(1).max(20).default(5),
  /**
   * Chunks below this cosine similarity are treated as irrelevant. If none pass, we answer
   * "not found" without calling the chat model. Calibrated with `npm run eval`.
   */
  MIN_SCORE: z.coerce.number().min(0).max(1).default(0.3),
  /** Fuse vector search with BM25 keyword search (see retrieve.ts). Set to false to compare in `npm run eval`. */
  HYBRID_SEARCH: z.enum(['true', 'false']).default('true'),
  /** Hard cap on answer length, which also caps the cost of a single request. */
  MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(1000),
  PRODUCT_NAME: z.string().default('TidyShift'),
  PORT: z.coerce.number().int().positive().default(3001),
  /** Requests per minute per IP on /api/chat. */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(20),
  /** Number of reverse proxies in front of the app (e.g. 1 on Render/Fly), so rate limiting sees real IPs. */
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  DOCS_DIR: z.string().default('data/docs'),
  DB_PATH: z.string().default('data/index.db'),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  // Treat `TOP_K=` (empty) the same as not set, so defaults apply.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);
  }
  const e = parsed.data;

  return {
    openaiApiKey: e.OPENAI_API_KEY,
    chatModel: e.CHAT_MODEL,
    embeddingModel: e.EMBEDDING_MODEL,
    topK: e.TOP_K,
    minScore: e.MIN_SCORE,
    hybridSearch: e.HYBRID_SEARCH === 'true',
    maxOutputTokens: e.MAX_OUTPUT_TOKENS,
    productName: e.PRODUCT_NAME,
    port: e.PORT,
    rateLimitPerMinute: e.RATE_LIMIT_PER_MINUTE,
    trustProxy: e.TRUST_PROXY,
    docsDir: path.resolve(ROOT, e.DOCS_DIR),
    dbPath: path.resolve(ROOT, e.DB_PATH),
    webDistDir: path.resolve(ROOT, 'web/dist'),
  };
}
