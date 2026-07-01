import { useMemo, useState, type ReactNode } from "react";

export type FilterOption = {
  id: string;
  label: string;
  count: number;
};

type ScreenerFiltersProps = {
  selectedCategories: Set<string>;
  onToggleCategory: (id: string) => void;
  onSelectAllCategories: () => void;
  onClearCategories: () => void;
  subCategoryOptions: FilterOption[];
  resultCount: number;
  loading?: boolean;
};

type FilterPanelProps = Pick<
  ScreenerFiltersProps,
  | "selectedCategories"
  | "onToggleCategory"
  | "onSelectAllCategories"
  | "onClearCategories"
  | "subCategoryOptions"
>;

function CategoryFilterList({
  selectedCategories,
  onToggleCategory,
  onSelectAllCategories,
  onClearCategories,
  subCategoryOptions,
}: FilterPanelProps) {
  const totalCount = useMemo(
    () => subCategoryOptions.reduce((sum, o) => sum + o.count, 0),
    [subCategoryOptions],
  );

  return (
    <>
      <div className="screener-filter-value-head">
        <span className="muted caption">
          {selectedCategories.size === 0
            ? `All categories (${totalCount})`
            : `${selectedCategories.size} selected`}
        </span>
        <div className="screener-filter-value-actions">
          <button type="button" className="screener-link-btn" onClick={onSelectAllCategories}>
            All
          </button>
          <button type="button" className="screener-link-btn" onClick={onClearCategories}>
            Clear
          </button>
        </div>
      </div>
      <div className="screener-check-list screener-check-list-desktop">
        {subCategoryOptions.map((opt) => {
          const checked = selectedCategories.size === 0 || selectedCategories.has(opt.id);
          const explicit = selectedCategories.has(opt.id);
          return (
            <label
              key={opt.id}
              className={`screener-check-row ${explicit ? "screener-check-row-active" : ""}`}
            >
              <input type="checkbox" checked={checked} onChange={() => onToggleCategory(opt.id)} />
              <span className="screener-check-label">{opt.label}</span>
              <span className="screener-chip-count">{opt.count}</span>
            </label>
          );
        })}
      </div>
    </>
  );
}

function categorySummary(
  selectedCategories: Set<string>,
  subCategoryOptions: FilterOption[],
): string {
  if (selectedCategories.size === 0) return "All";
  const labels = subCategoryOptions
    .filter((o) => selectedCategories.has(o.id))
    .map((o) => o.label);
  if (labels.length <= 2) return labels.join(", ");
  return `${labels.length} selected`;
}

function FilterAccordionSection({
  id,
  title,
  summary,
  badge,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  summary?: string;
  badge?: number;
  open: boolean;
  onToggle: (id: string) => void;
  children: ReactNode;
}) {
  return (
    <div className={`screener-filter-section ${open ? "screener-filter-section-open" : ""}`}>
      <button
        type="button"
        className="screener-filter-section-head"
        aria-expanded={open}
        aria-controls={`screener-filter-panel-${id}`}
        onClick={() => onToggle(id)}
      >
        <span className="screener-filter-section-chevron" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
        <span className="screener-filter-section-title">{title}</span>
        {badge ? <span className="screener-filter-section-badge">{badge}</span> : null}
        {!open && summary ? (
          <span className="screener-filter-section-summary">{summary}</span>
        ) : null}
      </button>
      {open ? (
        <div id={`screener-filter-panel-${id}`} className="screener-filter-section-body">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function ScreenerFilters(props: ScreenerFiltersProps) {
  const {
    selectedCategories,
    onToggleCategory,
    onSelectAllCategories,
    onClearCategories,
    subCategoryOptions,
    resultCount,
    loading = false,
  } = props;

  const [categoryOpen, setCategoryOpen] = useState(true);
  const filterCount = selectedCategories.size > 0 ? 1 : 0;
  const catSummary = categorySummary(selectedCategories, subCategoryOptions);

  return (
    <aside className="screener-sidebar panel-card" aria-label="Screener controls">
      <div className="screener-sidebar-head">
        <h3>Filters</h3>
        <p className="muted caption">
          {loading ? "Loading…" : `${resultCount.toLocaleString()} funds`}
        </p>
      </div>
      <div className="screener-filter-accordion">
        <FilterAccordionSection
          id="category"
          title="Category"
          summary={catSummary}
          badge={selectedCategories.size || undefined}
          open={categoryOpen}
          onToggle={() => setCategoryOpen((open) => !open)}
        >
          <CategoryFilterList
            selectedCategories={selectedCategories}
            onToggleCategory={onToggleCategory}
            onSelectAllCategories={onSelectAllCategories}
            onClearCategories={onClearCategories}
            subCategoryOptions={subCategoryOptions}
          />
        </FilterAccordionSection>
      </div>
      {filterCount ? (
        <button type="button" className="screener-clear-btn" onClick={onClearCategories}>
          Clear filters
        </button>
      ) : null}
    </aside>
  );
}
