import { type FormEvent, type KeyboardEvent, useLayoutEffect, useRef, useState } from 'react';
import { CHAT_LIMITS } from '../../../shared/chat-protocol.ts';
import { SendIcon, StopIcon } from './icons.tsx';

interface Props {
  onSend: (question: string) => void;
  onStop: () => void;
  busy: boolean;
}

const MAX_HEIGHT = 200;
const COUNTER_FROM = CHAT_LIMITS.questionMaxChars - 200;

export function Composer({ onSend, onStop, busy }: Props) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const canSend = value.trim().length > 0 && !busy;

  // Grow with the content up to MAX_HEIGHT, then scroll.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `value` is the trigger; the effect measures the DOM
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSend) return;
    onSend(value);
    setValue('');
    ref.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter adds a line. Don't send while an IME is composing (e.g. Japanese input).
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form className="composer" onSubmit={submit}>
      <div className="composer__box">
        <label htmlFor="question" className="sr-only">
          Ask a question about TidyShift
        </label>
        <textarea
          id="question"
          ref={ref}
          rows={1}
          value={value}
          maxLength={CHAT_LIMITS.questionMaxChars}
          placeholder="Ask about plans, billing, integrations…"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          // biome-ignore lint/a11y/noAutofocus: the input is the whole point of the page
          autoFocus
        />
        {busy ? (
          <button type="button" className="send-button send-button--stop" onClick={onStop} aria-label="Stop answering">
            <StopIcon />
          </button>
        ) : (
          <button type="submit" className="send-button" disabled={!canSend} aria-label="Send question">
            <SendIcon />
          </button>
        )}
      </div>
      <div className="composer__footer">
        <span>Answers are generated from the help center and can be wrong. Check the cited source.</span>
        {value.length >= COUNTER_FROM && (
          <span className="composer__counter" aria-live="polite">
            {value.length}/{CHAT_LIMITS.questionMaxChars}
          </span>
        )}
      </div>
    </form>
  );
}
