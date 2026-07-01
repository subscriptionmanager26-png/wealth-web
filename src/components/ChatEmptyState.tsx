type Props = {
  starters: string[];
  onSelect: (question: string) => void;
  disabled?: boolean;
  hasApiKey: boolean;
  hasPortfolioData: boolean;
  onSettingsOpen?: () => void;
};

export function ChatEmptyState({
  starters,
  onSelect,
  disabled,
  hasApiKey,
  hasPortfolioData,
  onSettingsOpen,
}: Props) {
  return (
    <div className="chat-empty-state">
      <div className="chat-empty-hero">
        <div className="chat-empty-icon" aria-hidden>
          ✦
        </div>
        <h2 className="chat-empty-title">Ask Munshi Ji</h2>
        <p className="chat-empty-subtitle">
          Portfolio answers grounded in your holdings, NAV, benchmarks, and fund metrics — not generic advice.
        </p>
      </div>

      {!hasPortfolioData ? (
        <p className="chat-empty-note">Upload a CAS statement first to enable portfolio-aware answers.</p>
      ) : !hasApiKey ? (
        <p className="chat-empty-note">
          Add your Mistral API key in{" "}
          <button type="button" className="chat-inline-link" onClick={onSettingsOpen}>
            Settings
          </button>{" "}
          to start chatting.
        </p>
      ) : (
        <div className="chat-starter-grid">
          {starters.map((q) => (
            <button
              key={q}
              type="button"
              className="chat-starter-card"
              onClick={() => onSelect(q)}
              disabled={disabled}
            >
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
