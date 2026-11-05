import { LogoMark, PlusIcon } from './icons.tsx';

export function Header({ onNewChat, canReset }: { onNewChat: () => void; canReset: boolean }) {
  return (
    <header className="header">
      <div className="header__brand">
        <LogoMark />
        <div>
          <h1 className="header__title">TidyShift Assistant</h1>
          <p className="header__subtitle">Answers from the help center, with sources</p>
        </div>
      </div>
      <div className="header__actions">
        <span className="badge" title="TidyShift is a fictional company created for this demo">
          Demo · fictional company
        </span>
        {canReset && (
          <button type="button" className="button button--ghost" onClick={onNewChat}>
            <PlusIcon width={16} height={16} /> New chat
          </button>
        )}
      </div>
    </header>
  );
}
