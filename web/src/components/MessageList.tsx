import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Message as ChatMessage } from '../hooks/useChat.ts';
import { Message } from './Message.tsx';

interface Props {
  messages: ChatMessage[];
  isBusy: boolean;
  onRetry: (assistantId: string) => void;
}

/** Distance from the bottom (px) within which we keep following the stream. */
const STICK_THRESHOLD = 96;

export function MessageList({ messages, isBusy, onRetry }: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // Follow the answer as it streams, unless the user scrolled up to read something.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  });

  // A new question always scrolls into view.
  const count = messages.length;
  useEffect(() => {
    if (count > 0) stickToBottom.current = true;
  }, [count]);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
  };

  return (
    <div className="scroller" ref={scrollerRef} onScroll={onScroll}>
      <div className="messages" role="log" aria-live="polite" aria-busy={isBusy} aria-label="Conversation">
        {messages.map((message) => (
          <Message key={message.id} message={message} onRetry={onRetry} canRetry={!isBusy} />
        ))}
      </div>
    </div>
  );
}
