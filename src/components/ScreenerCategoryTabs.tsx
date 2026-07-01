type ScreenerCategoryTabsProps = {
  options: { id: string; label: string; count: number }[];
  activeId: string;
  onChange: (id: string) => void;
};

function shortCategoryLabel(label: string): string {
  return label.replace(/ Fund$/, "").replace(/^Equity Scheme - /, "");
}

export function ScreenerCategoryTabs({ options, activeId, onChange }: ScreenerCategoryTabsProps) {
  return (
    <nav className="screener-cat-tabs" aria-label="Fund categories">
      <div className="screener-cat-tabs-scroll">
        {options.map((opt) => {
          const active = opt.id === activeId;
          return (
            <button
              key={opt.id}
              type="button"
              className={`screener-cat-tab ${active ? "screener-cat-tab-active" : ""}`}
              aria-current={active ? "true" : undefined}
              onClick={() => onChange(opt.id)}
            >
              <span className="screener-cat-tab-icon" aria-hidden>
                ◫
              </span>
              <span className="screener-cat-tab-label">{shortCategoryLabel(opt.label)}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
