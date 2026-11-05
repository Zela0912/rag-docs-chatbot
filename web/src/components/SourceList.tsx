import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Source } from '../../../shared/chat-protocol.ts';
import { DocIcon } from './icons.tsx';

/** Excerpts longer than this start collapsed (the CSS clamps them to a few lines). */
const COLLAPSE_FROM_CHARS = 260;

interface Props {
  messageId: string;
  sources: Source[];
  heading: string;
  activeId: number | null;
}

export function sourceElementId(messageId: string, sourceId: number): string {
  return `${messageId}-source-${sourceId}`;
}

export function SourceList({ messageId, sources, heading, activeId }: Props) {
  return (
    <section className="sources" aria-label={heading}>
      <h3 className="sources__heading">{heading}</h3>
      <ol className="sources__list">
        {sources.map((source) => (
          <SourceCard
            key={source.id}
            elementId={sourceElementId(messageId, source.id)}
            source={source}
            active={source.id === activeId}
          />
        ))}
      </ol>
    </section>
  );
}

function SourceCard({ source, elementId, active }: { source: Source; elementId: string; active: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLLIElement>(null);
  const long = source.text.length > COLLAPSE_FROM_CHARS;

  // Clicking a citation in the answer jumps here and opens the full excerpt.
  useEffect(() => {
    if (!active) return;
    setExpanded(true);
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    ref.current?.scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
    ref.current?.focus({ preventScroll: true });
  }, [active]);

  return (
    <li
      id={elementId}
      ref={ref}
      tabIndex={-1}
      className={`source${active ? ' source--active' : ''}`}
      aria-current={active ? 'true' : undefined}
    >
      <div className="source__header">
        <span className="source__id" aria-hidden="true">
          {source.id}
        </span>
        <DocIcon className="source__icon" />
        <span className="source__title">
          <span className="source__document">{source.document}</span>
          <span className="source__sep" aria-hidden="true">
            ›
          </span>
          <span className="source__location">{source.location}</span>
        </span>
      </div>
      {/* Docs are Markdown, so the excerpt is rendered, not shown as raw "**bold**". */}
      <blockquote className={`source__text markdown${long && !expanded ? ' source__text--collapsed' : ''}`}>
        <Markdown remarkPlugins={[remarkGfm]}>{source.text}</Markdown>
      </blockquote>
      <div className="source__footer">
        {long && (
          <button type="button" className="link-button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
            {expanded ? 'Show less' : 'Show full excerpt'}
          </button>
        )}
        <span className="source__meta" title="Cosine similarity between your question and this passage">
          {source.file} · similarity {source.score.toFixed(2)}
        </span>
      </div>
    </li>
  );
}
