import type { Section } from './loaders.ts';

export interface Chunk {
  location: string;
  text: string;
}

// ~1500 characters is roughly 350-400 English tokens: big enough to hold a full answer,
// small enough that retrieval stays precise and the prompt stays cheap.
const MAX_CHARS = 1500;
// Overlap keeps a sentence that sits on a chunk boundary findable from both sides.
const OVERLAP_CHARS = 200;

export function chunkSections(sections: Section[]): Chunk[] {
  return sections.flatMap((section) => splitText(section.text).map((text) => ({ location: section.location, text })));
}

/**
 * What we actually send to the embedding model. Prefixing the document title and section
 * means a chunk like "It costs $4 per user" still matches "How much is the Starter plan?".
 */
export function embeddingInput(title: string, chunk: Chunk): string {
  return `${title}\n${chunk.location}\n\n${chunk.text}`;
}

function splitText(text: string): string[] {
  if (text.length <= MAX_CHARS) return [text];

  const paragraphs = text.split(/\n\s*\n/).flatMap((p) => (p.length > MAX_CHARS ? splitLongParagraph(p) : [p]));

  const chunks: string[] = [];
  let current = '';

  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > MAX_CHARS) {
      chunks.push(current);
      current = `${tail(current, OVERLAP_CHARS)}\n\n${paragraph}`;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current) chunks.push(current);

  return chunks;
}

/** Split by sentences; fall back to a hard cut for a single giant sentence. */
function splitLongParagraph(paragraph: string): string[] {
  const pieces: string[] = [];
  let current = '';

  for (const sentence of paragraph.split(/(?<=[.!?])\s+/)) {
    if (sentence.length > MAX_CHARS) {
      if (current) pieces.push(current);
      current = '';
      for (let i = 0; i < sentence.length; i += MAX_CHARS) pieces.push(sentence.slice(i, i + MAX_CHARS));
    } else if (current && current.length + sentence.length + 1 > MAX_CHARS) {
      pieces.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) pieces.push(current);

  return pieces;
}

/** Last ~n characters, starting at a word boundary. */
function tail(text: string, n: number): string {
  if (text.length <= n) return text;
  const cut = text.slice(-n);
  const space = cut.indexOf(' ');
  return space >= 0 ? cut.slice(space + 1) : cut;
}
