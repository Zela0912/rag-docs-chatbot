import { Composer } from './components/Composer.tsx';
import { EmptyState } from './components/EmptyState.tsx';
import { Header } from './components/Header.tsx';
import { MessageList } from './components/MessageList.tsx';
import { useChat } from './hooks/useChat.ts';

export function App() {
  const { messages, isBusy, send, stop, retry, reset } = useChat();

  return (
    <div className="app">
      <Header onNewChat={reset} canReset={messages.length > 0} />
      <main className="main">
        {messages.length === 0 ? (
          <EmptyState onPick={send} />
        ) : (
          <MessageList messages={messages} isBusy={isBusy} onRetry={retry} />
        )}
      </main>
      <Composer onSend={send} onStop={stop} busy={isBusy} />
    </div>
  );
}
