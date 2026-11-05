import OpenAI from 'openai';
import { config } from './config.ts';

export const openai = new OpenAI({ apiKey: config.openaiApiKey });

// The embeddings endpoint accepts many inputs per request; batching keeps ingest fast.
const BATCH_SIZE = 100;

export async function embed(texts: string[]): Promise<{ vectors: Float32Array[]; tokens: number }> {
  const vectors: Float32Array[] = [];
  let tokens = 0;

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const res = await openai.embeddings.create({ model: config.embeddingModel, input: batch });
    // Each item carries its input index; sort so vectors line up with `texts`.
    for (const item of [...res.data].sort((a, b) => a.index - b.index)) {
      vectors.push(Float32Array.from(item.embedding));
    }
    tokens += res.usage.total_tokens;
  }

  return { vectors, tokens };
}
