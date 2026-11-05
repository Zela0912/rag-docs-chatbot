import path from 'node:path';
import { extractText, getDocumentProxy } from 'unpdf';

/** A piece of a document with a human-readable location we can cite ("Refunds", "Page 4"). */
export interface Section {
  location: string;
  text: string;
}

export interface LoadedDocument {
  title: string;
  sections: Section[];
}

export const SUPPORTED_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.pdf']);

export async function loadDocument(file: string, data: Buffer): Promise<LoadedDocument> {
  const ext = path.extname(file).toLowerCase();
  const fallbackTitle = path.basename(file, ext);

  if (ext === '.pdf') return loadPdf(fallbackTitle, data);
  if (SUPPORTED_EXTENSIONS.has(ext)) return loadMarkdown(fallbackTitle, data.toString('utf8'));
  throw new Error(`Unsupported file type: ${ext}`);
}

/**
 * Splits Markdown by headings. The heading path becomes the citation location,
 * e.g. "Plans › Annual billing". The first H1 is used as the document title.
 */
function loadMarkdown(fallbackTitle: string, source: string): LoadedDocument {
  let title: string | undefined;
  const headings: string[] = []; // headings[0] = H1, headings[1] = H2, ...
  const sections: Section[] = [];
  let buffer: string[] = [];
  let inCodeFence = false;

  const flush = () => {
    const text = buffer.join('\n').trim();
    if (text) {
      // Skip the H1 in the location: it is already the document title.
      const location = headings.slice(1).filter(Boolean).join(' › ') || 'Overview';
      sections.push({ location, text });
    }
    buffer = [];
  };

  for (const line of source.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) inCodeFence = !inCodeFence;
    const heading = inCodeFence ? null : /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);

    if (heading) {
      flush();
      const level = heading[1].length;
      const text = heading[2];
      if (level === 1 && title === undefined) title = text;
      headings.length = level - 1; // drop deeper headings from the previous section
      headings[level - 1] = text;
    } else {
      buffer.push(line);
    }
  }
  flush();

  return { title: title ?? fallbackTitle, sections };
}

/** One section per PDF page, so answers can cite "Page 4". */
async function loadPdf(fallbackTitle: string, data: Buffer): Promise<LoadedDocument> {
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { text: pages } = await extractText(pdf, { mergePages: false });

  const sections = pages
    .map((text, i) => ({ location: `Page ${i + 1}`, text: text.trim() }))
    .filter((section) => section.text.length > 0);

  return { title: fallbackTitle, sections };
}
