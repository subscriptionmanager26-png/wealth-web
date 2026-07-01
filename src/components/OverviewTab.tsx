import { formatInrFull, formatInrShort } from "../lib/format";

type OverviewTabProps = {
  hero: {
    total: number;
    invested: number;
    gain: number;
    xirr: string;
    dayChange: number;
    dayChangePct: number;
  };
  profileName: string;
  casCount: number;
};

export function OverviewTab({ hero, profileName, casCount }: OverviewTabProps) {
  const gainTone = hero.gain >= 0 ? "positive" : "negative";
  const dayTone = hero.dayChange >= 0 ? "positive" : "negative";

  return (
    <div className="overview-panel">
      <section className="overview-hero">
        <p className="overview-hero-label">Current portfolio value</p>
        <h2 className="overview-hero-value">{formatInrFull(hero.total)}</h2>
        <p className="overview-hero-meta">
          {profileName} · {casCount ? "From your CAS library" : "Upload a CAS to begin"}
        </p>
      </section>

      <section className="overview-row-card">
        <span className="overview-row-label">Total invested</span>
        <span className="overview-row-value">{formatInrFull(hero.invested)}</span>
      </section>

      <div className="overview-grid-2">
        <div className="overview-stat-card">
          <span className="overview-stat-label">Today&apos;s change</span>
          <span className={`overview-stat-value ${dayTone}`}>
            {hero.dayChange >= 0 ? "+" : ""}
            {formatInrShort(hero.dayChange)}
          </span>
          <span className={`overview-stat-sub ${dayTone}`}>
            {hero.dayChangePct >= 0 ? "+" : ""}
            {hero.dayChangePct.toFixed(2)}%
          </span>
        </div>
        <div className="overview-stat-card">
          <span className="overview-stat-label">Overall change</span>
          <span className={`overview-stat-value ${gainTone}`}>
            {hero.gain >= 0 ? "+" : ""}
            {formatInrShort(hero.gain)}
          </span>
          <span className={`overview-stat-sub ${gainTone}`}>{hero.xirr} XIRR</span>
        </div>
      </div>
    </div>
  );
}
