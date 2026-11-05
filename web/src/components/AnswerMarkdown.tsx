import { type ComponentProps, memo, useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Source } from '../../../shared/chat-protocol.ts';

const CITATION = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
const CITE_HREF = '#cite-';

/**
 * Turns "[1]" / "[1, 3]" markers into Markdown links (#cite-1) that we render as buttons.
 * Markers that don't match a real source are left as plain text, so the model can't
 * invent a clickable citation.
 */
export function linkCitations(text: string, validIds: ReadonlySet<number>): string {
  return text.replace(CITATION, (match, ids: string) => {
    const list = ids.split(',').map((s) => Number(s.trim()));
    if (!list.every((id) => validIds.has(id))) return match;
    return list.map((id) => `[${id}](${CITE_HREF}${id})`).join('');
  });
}

interface Props {
  content: string;
  sources: Source[];
  /** When omitted (e.g. while streaming), citations render as inert badges. */
  onCite?: (sourceId: number) => void;
}

/**
 * Renders the model's Markdown safely: react-markdown never injects raw HTML,
 * so a prompt-injected "<script>" in an answer is shown as text, not executed.
 */
export const AnswerMarkdown = memo(function AnswerMarkdown({ content, sources, onCite }: Props) {
  const byId = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources]);
  const markdown = useMemo(() => linkCitations(content, new Set(byId.keys())), [content, byId]);

  const components = useMemo(
    () => ({
      a: ({ href, children }: ComponentProps<'a'>) => {
        if (href?.startsWith(CITE_HREF)) {
          const id = Number(href.slice(CITE_HREF.length));
          const source = byId.get(id);
          const label = source ? `Source ${id}: ${source.document}, ${source.location}` : `Source ${id}`;
          return onCite ? (
            <button type="button" className="cite" onClick={() => onCite(id)} aria-label={label} title={label}>
              {id}
            </button>
          ) : (
            <span className="cite cite--inert" title={label}>
              {id}
            </span>
          );
        }
        return (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        );
      },
    }),
    [byId, onCite],
  );

  return (
    <div className="markdown">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown}
      </Markdown>
    </div>
  );
});
