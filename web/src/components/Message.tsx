import { memo, useCallback, useState } from 'react';
import type { AssistantMessage, Message as ChatMessage } from '../hooks/useChat.ts';
import { AnswerMarkdown } from './AnswerMarkdown.tsx';
import { AlertIcon, CheckIcon, CopyIcon, InfoIcon, LogoMark, RetryIcon } from './icons.tsx';
import { SourceList } from './SourceList.tsx';

interface Props {
  message: ChatMessage;
  onRetry: (assistantId: string) => void;
  canRetry: boolean;
}

export const Message = memo(function Message({ message, onRetry, canRetry }: Props) {
  if (message.role === 'user') {
    return (
      <div className="message message--user">
        <div className="bubble">{message.content}</div>
      </div>
    );
  }
  return <Answer message={message} onRetry={onRetry} canRetry={canRetry} />;
});

function Answer({ message, onRetry, canRetry }: { message: AssistantMessage } & Omit<Props, 'message'>) {
  const [activeSource, setActiveSource] = useState<number | null>(null);
  const done = message.status === 'done';

  // Re-clicking the same citation should scroll to it again, so reset first.
  const cite = useCallback((id: number) => {
    setActiveSource(null);
    requestAnimationFrame(() => setActiveSource(id));
  }, []);

  const cited = message.sources.filter((s) => message.cited.includes(s.id));
  // If the model answered without citing, still show what it was given, labelled honestly.
  const shown = cited.length > 0 ? cited : message.sources;
  const showSources = done && !message.notFound && shown.length > 0;

  return (
    <div className="message message--assistant">
      <div className="avatar" aria-hidden="true">
        <LogoMark width={28} height={28} />
      </div>
      <div className="answer">
        {message.status === 'searching' && message.content === '' && (
          <p className="thinking" role="status">
            {message.sources.length > 0 ? `Reading ${message.sources.length} passages` : 'Searching the documentation'}
            <span className="dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </p>
        )}

        {message.content !== '' &&
          (message.notFound ? (
            <div className="callout callout--info">
              <InfoIcon />
              <p>{message.content}</p>
            </div>
          ) : (
            <div className={message.status === 'streaming' ? 'streaming' : undefined}>
              <AnswerMarkdown content={message.content} sources={message.sources} onCite={done ? cite : undefined} />
            </div>
          ))}

        {message.status === 'error' && (
          <div className="callout callout--error" role="alert">
            <AlertIcon />
            <p>{message.error}</p>
            {canRetry && (
              <button type="button" className="button button--small" onClick={() => onRetry(message.id)}>
                <RetryIcon width={14} height={14} /> Try again
              </button>
            )}
          </div>
        )}

        {message.status === 'stopped' && (
          <div className="stopped">
            <span>Answer stopped.</span>
            {canRetry && (
              <button type="button" className="link-button" onClick={() => onRetry(message.id)}>
                Regenerate
              </button>
            )}
          </div>
        )}

        {showSources && (
          <SourceList
            messageId={message.id}
            sources={shown}
            heading={cited.length > 0 ? 'Sources' : 'Related passages'}
            activeId={activeSource}
          />
        )}

        {done && !message.notFound && <AnswerActions text={message.content} requestId={message.requestId} />}
      </div>
    </div>
  );
}

function AnswerActions({ text, requestId }: { text: string; requestId?: string }) {
  const [copied, setCopied] = useState(false);
  const canCopy = typeof navigator !== 'undefined' && !!navigator.clipboard;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text.replace(/\s?\[\d+(?:\s*,\s*\d+)*\]/g, ''));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard permission denied; nothing useful to show.
    }
  };

  if (!canCopy) return null;
  return (
    <div className="answer-actions">
      <button type="button" className="icon-button" onClick={copy} aria-label={copied ? 'Copied' : 'Copy answer'}>
        {copied ? <CheckIcon width={16} height={16} /> : <CopyIcon width={16} height={16} />}
      </button>
      {requestId && <span className="sr-only">Request ID {requestId}</span>}
    </div>
  );
}
