import type OpenAI from 'openai';
import type { AnswerChunk, Answerer, AnswerRequest, Embedder } from './types.ts';

// The embeddings endpoint accepts many inputs per request; batching keeps ingest fast.
const EMBED_BATCH_SIZE = 100;

export function createOpenAIEmbedder(client: OpenAI, model: string): Embedder {
  return {
    model,
    async embed(texts) {
      const vectors: Float32Array[] = [];
      let tokens = 0;

      for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
        const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
        const res = await client.embeddings.create({ model, input: batch });
        // Each item carries its input index; sort so vectors line up with `texts`.
        for (const item of [...res.data].sort((a, b) => a.index - b.index)) {
          vectors.push(Float32Array.from(item.embedding));
        }
        tokens += res.usage.total_tokens;
      }

      return { vectors, tokens };
    },
  };
}

export function createOpenAIAnswerer(client: OpenAI, model: string, options: { maxOutputTokens: number }): Answerer {
  return {
    model,
    async *stream({ instructions, input, signal }: AnswerRequest): AsyncIterable<AnswerChunk> {
      const stream = await client.responses.create(
        {
          model,
          instructions,
          input,
          max_output_tokens: options.maxOutputTokens,
          // We don't need OpenAI to keep a copy of support conversations.
          store: false,
          stream: true,
        },
        { signal },
      );

      for await (const event of stream) {
        switch (event.type) {
          case 'response.output_text.delta':
            yield { type: 'delta', text: event.delta };
            break;
          case 'response.completed':
          case 'response.incomplete': {
            const usage = event.response.usage;
            if (usage) {
              yield { type: 'usage', usage: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens } };
            }
            break;
          }
          case 'response.failed':
            throw new Error(`OpenAI response failed: ${event.response.error?.message ?? 'unknown error'}`);
          case 'error':
            throw new Error(`OpenAI stream error: ${event.message}`);
        }
      }
    },

    async complete({ instructions, input, signal, maxOutputTokens }) {
      const res = await client.responses.create(
        { model, instructions, input, max_output_tokens: maxOutputTokens, store: false },
        { signal },
      );
      const usage = res.usage ? { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens } : null;
      return { text: res.output_text, usage };
    },
  };
}
