const SUGGESTIONS = [
  'Can I get a refund on an annual plan?',
  'How do I connect Slack?',
  "Employees aren't getting shift notifications",
  'Where is our data stored?',
];

export function EmptyState({ onPick }: { onPick: (question: string) => void }) {
  return (
    <div className="empty">
      <h2 className="empty__title">How can we help?</h2>
      <p className="empty__text">
        Ask anything about TidyShift. Every answer comes from the help center and links to the exact passage it used. If
        the docs don't cover it, the assistant says so instead of guessing.
      </p>
      <ul className="suggestions" aria-label="Example questions">
        {SUGGESTIONS.map((question) => (
          <li key={question}>
            <button type="button" className="suggestion" onClick={() => onPick(question)}>
              {question}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
