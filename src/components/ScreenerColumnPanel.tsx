import type { ColumnConfig, FundamentalId, ReturnType, TimePeriod } from "./screenerTypes";
import {
  FUNDAMENTAL_OPTIONS,
  MAX_FUNDAMENTALS,
  MAX_TIME_PERIODS,
  RETURN_TYPE_OPTIONS,
  TIME_PERIOD_OPTIONS,
} from "./screenerTypes";

type ScreenerColumnPanelProps = {
  config: ColumnConfig;
  onChange: (config: ColumnConfig) => void;
};

export function ScreenerColumnPanel({ config, onChange }: ScreenerColumnPanelProps) {
  const setReturnType = (returnType: ReturnType) => {
    onChange({ ...config, returnType });
  };

  const toggleTimePeriod = (period: TimePeriod) => {
    const selected = config.timePeriods;
    if (selected.includes(period)) {
      if (selected.length <= 1) return;
      onChange({ ...config, timePeriods: selected.filter((p) => p !== period) });
      return;
    }
    if (selected.length >= MAX_TIME_PERIODS) return;
    onChange({ ...config, timePeriods: [...selected, period] });
  };

  const toggleFundamental = (id: FundamentalId) => {
    const selected = config.fundamentals;
    if (selected.includes(id)) {
      if (selected.length <= 1) return;
      onChange({ ...config, fundamentals: selected.filter((f) => f !== id) });
      return;
    }
    if (selected.length >= MAX_FUNDAMENTALS) return;
    onChange({ ...config, fundamentals: [...selected, id] });
  };

  return (
    <div className="screener-panel-fields">
      <div className="screener-column-section">
        <p className="screener-filter-label">Return type</p>
        <p className="muted caption">Choose 1</p>
        <div className="screener-sort-list" role="radiogroup" aria-label="Return type">
          {RETURN_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={config.returnType === opt.id}
              className={`screener-sort-option ${config.returnType === opt.id ? "screener-sort-option-active" : ""}`}
              onClick={() => setReturnType(opt.id)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="screener-column-section">
        <p className="screener-filter-label">Time period</p>
        <p className="muted caption">
          Choose up to {MAX_TIME_PERIODS} ({config.timePeriods.length}/{MAX_TIME_PERIODS})
        </p>
        <div className="screener-column-checks">
          {TIME_PERIOD_OPTIONS.map((opt) => {
            const checked = config.timePeriods.includes(opt.id);
            const disabled = !checked && config.timePeriods.length >= MAX_TIME_PERIODS;
            return (
              <label
                key={opt.id}
                className={`screener-check-row ${checked ? "screener-check-row-active" : ""} ${disabled ? "screener-check-row-disabled" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => toggleTimePeriod(opt.id)}
                />
                <span>{opt.label}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="screener-column-section">
        <p className="screener-filter-label">Fundamentals</p>
        <p className="muted caption">
          Choose up to {MAX_FUNDAMENTALS} ({config.fundamentals.length}/{MAX_FUNDAMENTALS})
        </p>
        <div className="screener-column-checks">
          {FUNDAMENTAL_OPTIONS.map((opt) => {
            const checked = config.fundamentals.includes(opt.id);
            const disabled = !checked && config.fundamentals.length >= MAX_FUNDAMENTALS;
            return (
              <label
                key={opt.id}
                className={`screener-check-row ${checked ? "screener-check-row-active" : ""} ${disabled ? "screener-check-row-disabled" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => toggleFundamental(opt.id)}
                />
                <span>{opt.label}</span>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}
