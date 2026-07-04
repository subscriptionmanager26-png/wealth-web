import { Wealth } from "../theme/wealthTheme";
import type { BottomTabId, HomeTabId } from "../hooks/usePortfolioApp";

const HOME_TABS: { id: HomeTabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "analysis", label: "Analysis" },
  { id: "insights", label: "Insights" },
  { id: "funds", label: "Funds" },
];

export type AccountSubTabId = "details" | "uploaded";

type LayoutProps = {
  bottomTab: BottomTabId;
  onBottomTabChange: (tab: BottomTabId) => void;
  homeTab: HomeTabId;
  onHomeTabChange: (tab: HomeTabId) => void;
  accountSubTab?: AccountSubTabId;
  onAccountSubTabChange?: (tab: AccountSubTabId) => void;
  onUploadClick: () => void;
  uploadBusy: boolean;
  amfiMappingBusy: boolean;
  onAiSettingsClick?: () => void;
  onAiMenuClick?: () => void;
  onAiNewChatClick?: () => void;
  aiNewChatDisabled?: boolean;
  children: React.ReactNode;
};

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg className="bottom-nav-svg" viewBox="0 0 24 24" aria-hidden>
      <path
        fill={active ? Wealth.orange : Wealth.textMuted}
        d={
          active
            ? "M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"
            : "M12 5.69l5 4.5V18h-2v-6H9v6H7v-7.31l5-4.5M12 3L2 12h3v8h6v-6h2v6h6v-8h3z"
        }
      />
    </svg>
  );
}

function TrackerIcon({ active }: { active: boolean }) {
  return (
    <svg className="bottom-nav-svg" viewBox="0 0 24 24" aria-hidden>
      <path
        fill={active ? Wealth.orange : Wealth.textMuted}
        d="M3 3h8v8H3V3zm10 0h8v5h-8V3zM3 13h5v8H3v-8zm7 4h11v4H10v-4zm-4 2h2v2H6v-2z"
      />
    </svg>
  );
}

function ScreenerIcon({ active }: { active: boolean }) {
  return (
    <svg className="bottom-nav-svg" viewBox="0 0 24 24" aria-hidden>
      <path
        fill={active ? Wealth.orange : Wealth.textMuted}
        d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 3h7v4h-7v-4z"
      />
    </svg>
  );
}

function AiIcon({ active }: { active: boolean }) {
  return (
    <svg className="bottom-nav-svg" viewBox="0 0 24 24" aria-hidden>
      <path
        fill={active ? Wealth.orange : Wealth.textMuted}
        d="M9.5 3A6.5 6.5 0 0 1 16 9.5c0 1.57-.56 3.01-1.49 4.13L21 20.12 20.12 21l-6.37-6.37A6.47 6.47 0 0 1 9.5 16 6.5 6.5 0 0 1 3 9.5 6.5 6.5 0 0 1 9.5 3zm0 2A4.5 4.5 0 0 0 5 9.5 4.5 4.5 0 0 0 9.5 14 4.5 4.5 0 0 0 14 9.5 4.5 4.5 0 0 0 9.5 5z"
      />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg className="header-settings-icon" viewBox="0 0 24 24" aria-hidden>
      <path fill="currentColor" d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg className="header-settings-icon" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.02 7.02 0 0 0-1.63-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.47.41l-.36 2.54c-.59.22-1.13.54-1.63.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.3.59.22l2.39-.96c.5.4 1.04.72 1.63.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.22 1.13-.54 1.63-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"
      />
    </svg>
  );
}
function ProfileIcon({ active }: { active: boolean }) {
  return (
    <svg className="bottom-nav-svg" viewBox="0 0 24 24" aria-hidden>
      <path
        fill={active ? Wealth.orange : Wealth.textMuted}
        d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"
      />
    </svg>
  );
}

export function Layout({
  bottomTab,
  onBottomTabChange,
  homeTab,
  onHomeTabChange,
  accountSubTab = "uploaded",
  onAccountSubTabChange,
  onUploadClick,
  uploadBusy,
  amfiMappingBusy,
  onAiSettingsClick,
  onAiMenuClick,
  onAiNewChatClick,
  aiNewChatDisabled,
  children,
}: LayoutProps) {
  return (
    <div className="app-shell">
      <header className={`app-header ${bottomTab === "home" ? "app-header-home" : ""}`}>
        {bottomTab === "home" ? (
          <nav className="tab-nav" aria-label="Portfolio sections">
            {HOME_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`tab-btn ${homeTab === t.id ? "tab-btn-active" : ""}`}
                onClick={() => onHomeTabChange(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
        ) : bottomTab === "tracker" ? (
          <div className="header-inner">
            <h1 className="brand">Tracker</h1>
            <button type="button" className="upload-btn" onClick={onUploadClick} disabled={uploadBusy}>
              {uploadBusy ? "Processing…" : "Add PDFs"}
            </button>
          </div>
        ) : bottomTab === "screener" ? (
          <div className="header-inner">
            <h1 className="brand">Fund Screener</h1>
            <span className="header-spacer" />
          </div>
        ) : bottomTab === "ai" ? (
          <div className="header-inner header-inner-ai">
            <div className="header-ai-left">
              <button type="button" className="header-icon-btn" onClick={onAiMenuClick} aria-label="Chat history">
                <MenuIcon />
              </button>
              <h1 className="brand">Munshi Ji</h1>
            </div>
            <div className="header-ai-right">
              <button
                type="button"
                className="header-text-btn"
                onClick={onAiNewChatClick}
                disabled={aiNewChatDisabled}
              >
                New Chat
              </button>
              <button type="button" className="header-settings-btn" onClick={onAiSettingsClick} aria-label="AI settings">
                <SettingsIcon />
              </button>
            </div>
          </div>
        ) : bottomTab === "account" ? (
          <div className="header-inner">
            <h1 className="brand">My Account</h1>
            {accountSubTab === "uploaded" ? (
              <button type="button" className="upload-btn" onClick={onUploadClick} disabled={uploadBusy}>
                {uploadBusy ? "Saving…" : "Upload CAS"}
              </button>
            ) : (
              <span className="header-spacer" />
            )}
          </div>
        ) : null}
      </header>

      {bottomTab === "account" ? (
        <div className="profile-sub-tab-outer">
          <nav className="profile-sub-tab-bar" aria-label="Account sections">
            <button
              type="button"
              className={`profile-sub-tab-btn ${accountSubTab === "details" ? "profile-sub-tab-btn-active" : ""}`}
              onClick={() => onAccountSubTabChange?.("details")}
            >
              Details
            </button>
            <button
              type="button"
              className={`profile-sub-tab-btn ${accountSubTab === "uploaded" ? "profile-sub-tab-btn-active" : ""}`}
              onClick={() => onAccountSubTabChange?.("uploaded")}
            >
              Uploaded CAS
            </button>
          </nav>
        </div>
      ) : null}

      <main className="app-main">{children}</main>

      <nav className="bottom-nav" aria-label="Main navigation">
        <button
          type="button"
          className={`bottom-nav-btn ${bottomTab === "home" ? "bottom-nav-btn-active" : ""}`}
          onClick={() => onBottomTabChange("home")}
        >
          <HomeIcon active={bottomTab === "home"} />
          <span>Mutual Fund</span>
        </button>
        <button
          type="button"
          className={`bottom-nav-btn ${bottomTab === "tracker" ? "bottom-nav-btn-active" : ""}`}
          onClick={() => onBottomTabChange("tracker")}
        >
          <TrackerIcon active={bottomTab === "tracker"} />
          <span>Tracker</span>
        </button>
        <button
          type="button"
          className={`bottom-nav-btn ${bottomTab === "screener" ? "bottom-nav-btn-active" : ""}`}
          onClick={() => onBottomTabChange("screener")}
        >
          <ScreenerIcon active={bottomTab === "screener"} />
          <span>Screener</span>
        </button>
        <button
          type="button"
          className={`bottom-nav-btn ${bottomTab === "ai" ? "bottom-nav-btn-active" : ""}`}
          onClick={() => onBottomTabChange("ai")}
        >
          <AiIcon active={bottomTab === "ai"} />
          <span>AI</span>
        </button>
        <button
          type="button"
          className={`bottom-nav-btn ${bottomTab === "account" ? "bottom-nav-btn-active" : ""}`}
          onClick={() => onBottomTabChange("account")}
        >
          <ProfileIcon active={bottomTab === "account"} />
          <span>Profile</span>
          {amfiMappingBusy ? <span className="bottom-nav-badge" /> : null}
        </button>
      </nav>
    </div>
  );
}

export function EmptyState({
  title,
  body,
  onUploadClick,
  uploadBusy,
  onScreenerClick,
}: {
  title: string;
  body: string;
  onUploadClick?: () => void;
  uploadBusy?: boolean;
  onScreenerClick?: () => void;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon" style={{ background: Wealth.orange50, color: Wealth.orange }}>
        📄
      </div>
      <h2>{title}</h2>
      <p>{body}</p>
      {onUploadClick ? (
        <button type="button" className="btn-primary empty-upload-btn" onClick={onUploadClick} disabled={uploadBusy}>
          {uploadBusy ? "Saving…" : "Upload CAS"}
        </button>
      ) : null}
      {onScreenerClick ? (
        <button type="button" className="btn-secondary empty-upload-btn" onClick={onScreenerClick}>
          Browse equity fund screener
        </button>
      ) : null}
    </div>
  );
}
