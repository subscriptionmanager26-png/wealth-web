import { useMemo, useState } from "react";

import { buildFundSellInsights } from "@mobile/utils/fundSellInsights";
import type { BenchmarkMonthEndPoint } from "@mobile/utils/benchmarkTypes";
import type { UpvalySchemeDetail } from "@mobile/utils/upvalyMfApi";

type InsightsTabProps = {
  holdings: {
    id: string;
    name: string;
    category: string;
    subCategory?: string;
    returnPct: number;
    amount: number;
    amfiCode?: string;
  }[];
  equityPct: number;
  familyXirr: string;
  upvalySchemes: Record<string, UpvalySchemeDetail>;
  nifty500MonthEnds: BenchmarkMonthEndPoint[];
  insightsLoading?: boolean;
};

function StarRow({ count, max = 5 }: { count: number; max?: number }) {
  return (
    <span className="stars">
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={i < count ? "star-on" : "star-off"}>
          ★
        </span>
      ))}
    </span>
  );
}

export function InsightsTab({
  holdings,
  equityPct,
  familyXirr,
  upvalySchemes,
  nifty500MonthEnds,
  insightsLoading = false,
}: InsightsTabProps) {
  const [holdOpen, setHoldOpen] = useState(true);
  const [sellOpen, setSellOpen] = useState(true);

  const { holdFunds, sellFunds } = useMemo(
    () =>
      buildFundSellInsights(
        holdings.map((h) => ({
          id: h.id,
          name: h.name,
          category: h.category,
          subCategory: h.subCategory ?? h.category,
          returnPct: h.returnPct,
          amount: h.amount,
          amfiCode: h.amfiCode,
        })),
        upvalySchemes,
        nifty500MonthEnds,
      ),
    [holdings, nifty500MonthEnds, upvalySchemes],
  );

  const largeCapSkew = equityPct >= 55;

  return (
    <div className="tab-panel">
      <p className="intro-text">Personalized strategy & fund recommendations from your CAS holdings.</p>

      {insightsLoading ? (
        <div className="loading-row">
          <span className="spinner" />
          <span>Loading scheme fundamentals for insights…</span>
        </div>
      ) : null}

      <section className="panel-card">
        <p className="eyebrow">Portfolio alignment</p>
        <div className="align-card">
          <div className="align-tags">
            <span className="tag tag-green">Growth tilt</span>
            <span className="tag tag-muted">Family XIRR {familyXirr}</span>
          </div>
          <h3 className="align-title">
            {largeCapSkew ? "Equity-heavy with room to rebalance." : "Allocation looks balanced for your horizon."}
          </h3>
          <p className="body-text">
            {largeCapSkew
              ? `Equity is about ${equityPct.toFixed(0)}% of mapped holdings. Consider adding mid/small-cap or debt sleeves so drawdowns stay within comfort.`
              : "Your mix across equity, debt, and hybrid sleeves is within a typical diversified band. Revisit after the next CAS upload."}
          </p>
        </div>
      </section>

      <section className="accordion">
        <button type="button" className="acc-head acc-head-hold" onClick={() => setHoldOpen((v) => !v)}>
          <span>Funds to hold ({holdFunds.length})</span>
          <span>{holdOpen ? "▲" : "▼"}</span>
        </button>
        {holdOpen ? (
          <div className="acc-body">
            {!holdFunds.length ? (
              <p className="muted">No stand-out performers without sell flags yet.</p>
            ) : (
              holdFunds.map((f) => (
                <div key={f.id} className="fund-card fund-card-hold">
                  <div className="fund-card-top">
                    <strong>{f.name}</strong>
                    <StarRow count={f.returnPct >= 25 ? 5 : f.returnPct >= 18 ? 4 : 3} />
                  </div>
                  <p className="muted">{f.reason}</p>
                </div>
              ))
            )}
          </div>
        ) : null}
      </section>

      <section className="accordion">
        <button type="button" className="acc-head acc-head-sell" onClick={() => setSellOpen((v) => !v)}>
          <span>Funds to sell ({sellFunds.length})</span>
          <span>{sellOpen ? "▲" : "▼"}</span>
        </button>
        {sellOpen ? (
          <div className="acc-body">
            {!sellFunds.length ? (
              <p className="muted">No funds flagged by sell rules.</p>
            ) : (
              sellFunds.map((f) => (
                <div key={f.id} className="fund-card fund-card-sell">
                  <strong>{f.name}</strong>
                  <ul className="sell-reasons">
                    {f.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}
