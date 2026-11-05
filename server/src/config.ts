import path from 'node:path';

// Project root (docs-chatbot/), so relative paths work no matter where the script is started.
const root = path.resolve(import.meta.dirname, '../..');

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env var ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

function number(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (Number.isNaN(value)) throw new Error(`Env var ${name} must be a number, got "${raw}".`);
  return value;
}

export const config = {
  openaiApiKey: required('OPENAI_API_KEY'),
  chatModel: process.env.CHAT_MODEL || 'gpt-6-luna',
  embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
  // How many chunks we hand to the model per question.
  topK: number('TOP_K', 5),
  // Chunks below this cosine similarity are treated as "not relevant".
  // If nothing passes, we answer "not found" without calling the chat model at all.
  minScore: number('MIN_SCORE', 0.3),
  productName: process.env.PRODUCT_NAME || 'TidyShift',
  port: number('PORT', 3001),
  docsDir: path.resolve(root, process.env.DOCS_DIR || 'data/docs'),
  dbPath: path.resolve(root, process.env.DB_PATH || 'data/index.db'),
};
