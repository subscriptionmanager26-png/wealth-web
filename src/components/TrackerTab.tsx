import { useMemo, useState } from "react";

import type { BrokerConnectionState } from "../hooks/useBrokerMcp";
import { formatInrFull } from "../lib/format";
import type { SavedBrokerSync } from "../lib/brokerLibrary";
import { TRACKER_KIND_LABELS, type TrackerStatementView } from "../lib/trackerAggregation";
import type { SavedTrackerFile } from "../lib/trackerLibrary";
import type { BrokerId } from "../lib/brokers";
import { BrokerConnectPanel } from "./BrokerConnectPanel";
import { EmptyState } from "./Layout";

type TrackerTabProps = {
  trackerFiles: SavedTrackerFile[];
  statements: TrackerStatementView[];
  uploadBusy: boolean;
  hydrating: boolean;
  onUploadClick: () => void;
  onRemove: (id: string) => void;
  brokerStates: Record<BrokerId, BrokerConnectionState>;
  brokerSyncs: SavedBrokerSync[];
  brokerHydrating: boolean;
  onBrokerAuthorize: (id: BrokerId) => void;
  onBrokerConnect: (id: BrokerId) => void;
  onBrokerDisconnect: (id: BrokerId) => void;
  onBrokerZerodhaLogin: (id: BrokerId) => void;
  onBrokerSync: (id: BrokerId) => void;
  onBrokerRemoveSync: (id: string) => void;
};

function formatPeriod(from: string | null, to: string | null): string {
  if (from && to) return `${from} → ${to}`;
  if (to) return `as on ${to}`;
  if (from) return `from ${from}`;
  return "—";
}

function formatPrice(value: string | null | undefined): string {
  if (!value) return "—";
  const n = Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return "—";
  return formatInrFull(n);
}

export function TrackerTab({
  trackerFiles,
  statements,
  uploadBusy,
  hydrating,
  onUploadClick,
  onRemove,
  brokerStates,
  brokerSyncs,
  brokerHydrating,
  onBrokerAuthorize,
  onBrokerConnect,
  onBrokerDisconnect,
  onBrokerZerodhaLogin,
  onBrokerSync,
  onBrokerRemoveSync,
}: TrackerTabProps) {
  const [expandedId, setExpandedId] = useState<string | null>(statements[0]?.file.id ?? null);

  const totals = useMemo(() => {
    let mf = 0;
    let demat = 0;
    let nps = 0;
    for (const s of statements) {
      mf += s.totalMfValueInr;
      demat += s.totalDematValueInr;
      nps += s.totalNpsValueInr;
    }
    return { mf, demat, nps, all: mf + demat + nps };
  }, [statements]);

  if (hydrating || brokerHydrating) {
    return (
      <div className="loading-row center">
        <span className="spinner" /> Loading tracker…
      </div>
    );
  }

  const hasPdfData = trackerFiles.length > 0;

  return (
    <div className="tab-panel tracker-panel">
      <BrokerConnectPanel
        states={brokerStates}
        brokerSyncs={brokerSyncs}
        onAuthorize={onBrokerAuthorize}
        onConnect={onBrokerConnect}
        onDisconnect={onBrokerDisconnect}
        onZerodhaLogin={onBrokerZerodhaLogin}
        onSync={onBrokerSync}
        onRemoveSync={onBrokerRemoveSync}
      />

      {!hasPdfData ? (
        <EmptyState
          title="Statement PDFs"
          body="Upload CAS, MF Central, CDSL, or NPS PDFs. Each statement is shown separately with its period — not merged as live data."
          onUploadClick={onUploadClick}
          uploadBusy={uploadBusy}
        />
      ) : (
        <>
          <section className="panel-card">
            <div className="section-head-row">
              <div>
                <h2 className="section-title">Statement PDFs</h2>
                <p className="muted">
                  {statements.length} statement{statements.length !== 1 ? "s" : ""} · values are from each PDF&apos;s period, not live
                </p>
              </div>
              <button type="button" className="btn-primary" onClick={onUploadClick} disabled={uploadBusy}>
                {uploadBusy ? "Processing…" : "Add PDF"}
              </button>
            </div>
            <div className="tracker-summary-grid">
              <div className="tracker-summary-card">
                <span className="tracker-summary-label">Statements</span>
                <strong className="tracker-summary-value">{statements.length}</strong>
              </div>
              <div className="tracker-summary-card">
                <span className="tracker-summary-label">MF (all statements)</span>
                <strong className="tracker-summary-value">{formatInrFull(totals.mf)}</strong>
              </div>
              <div className="tracker-summary-card">
                <span className="tracker-summary-label">Demat (all statements)</span>
                <strong className="tracker-summary-value">{formatInrFull(totals.demat)}</strong>
              </div>
              <div className="tracker-summary-card">
                <span className="tracker-summary-label">NPS (all statements)</span>
                <strong className="tracker-summary-value">{formatInrFull(totals.nps)}</strong>
              </div>
            </div>
            <p className="muted tracker-dedup-note">
              Holdings are grouped by uploaded statement. Overlaps across PDFs are not deduplicated yet.
            </p>
          </section>

          <section className="panel-card">
            <h2 className="section-title">Statements</h2>
            <div className="tracker-statement-list">
              {statements.map((stmt) => {
                const { file } = stmt;
                const isOpen = expandedId === file.id;
                const stmtTotal = stmt.totalMfValueInr + stmt.totalDematValueInr + stmt.totalNpsValueInr;
                const holdingCount =
                  stmt.mfHoldings.length +
                  stmt.dematHoldings.length +
                  stmt.lockedDematHoldings.length +
                  stmt.npsHoldings.length;

                return (
                  <div key={file.id} className="tracker-statement-block">
                    <div className="tracker-statement-head">
                      <button
                        type="button"
                        className="tracker-statement-toggle"
                        onClick={() => setExpandedId(isOpen ? null : file.id)}
                      >
                        <div>
                          <strong>{file.name}</strong>
                          <div className="tracker-file-meta">
                            <span className="tracker-kind-badge">{TRACKER_KIND_LABELS[file.statementKind]}</span>
                            <span className="tracker-period-badge">{formatPeriod(file.periodFrom, file.periodTo)}</span>
                            {file.investorName ? <span>{file.investorName}</span> : null}
                          </div>
                        </div>
                        <div className="tracker-statement-head-right">
                          <span className="muted">{holdingCount} holdings</span>
                          <span>{formatInrFull(stmtTotal)}</span>
                        </div>
                      </button>
                      <button type="button" className="btn-text-danger" onClick={() => onRemove(file.id)}>
                        Remove
                      </button>
                    </div>

                    {isOpen ? (
                      <div className="tracker-statement-body">
                        {stmt.mfHoldings.length > 0 ? (
                          <div className="tracker-statement-section">
                            <h3>Mutual funds ({stmt.mfHoldings.length}) · {formatInrFull(stmt.totalMfValueInr)}</h3>
                            <div className="tracker-holdings-table-wrap">
                              <table className="tracker-holdings-table">
                                <thead>
                                  <tr>
                                    <th>AMC</th>
                                    <th>Scheme</th>
                                    <th>Folio</th>
                                    <th>Value</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {stmt.mfHoldings.map((h, i) => (
                                    <tr key={`${h.folio_no}-${h.isin}-${i}`}>
                                      <td>{h.amc ?? "—"}</td>
                                      <td>{h.scheme_name ?? "—"}</td>
                                      <td>{h.folio_no ?? "—"}</td>
                                      <td>{formatPrice(h.market_value_inr)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ) : null}

                        {stmt.dematHoldings.length > 0 ? (
                          <div className="tracker-statement-section">
                            <h3>Demat ({stmt.dematHoldings.length}) · {formatInrFull(stmt.totalDematValueInr)}</h3>
                            <div className="tracker-holdings-table-wrap">
                              <table className="tracker-holdings-table">
                                <thead>
                                  <tr>
                                    <th>Security</th>
                                    <th>ISIN</th>
                                    <th>Qty</th>
                                    <th>Price</th>
                                    <th>Value</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {stmt.dematHoldings.map((h, i) => (
                                    <tr key={`${h.isin}-${i}`}>
                                      <td>{h.security_name}</td>
                                      <td>{h.isin}</td>
                                      <td>{h.current_balance}</td>
                                      <td>{formatPrice(h.market_price_inr)}</td>
                                      <td>{formatPrice(h.market_value_inr)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ) : null}

                        {stmt.lockedDematHoldings.length > 0 ? (
                          <div className="tracker-statement-section">
                            <h3>
                              Locked demat units ({stmt.lockedDematHoldings.length}) · price not in statement
                            </h3>
                            <div className="tracker-holdings-table-wrap">
                              <table className="tracker-holdings-table">
                                <thead>
                                  <tr>
                                    <th>Security</th>
                                    <th>ISIN</th>
                                    <th>Qty</th>
                                    <th>Unlock date</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {stmt.lockedDematHoldings.map((h, i) => (
                                    <tr key={`lock-${h.isin}-${h.lockin_release_date}-${i}`}>
                                      <td>{h.security_name}</td>
                                      <td>{h.isin}</td>
                                      <td>{h.current_balance}</td>
                                      <td>{h.lockin_release_date ?? "—"}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ) : null}

                        {stmt.npsHoldings.length > 0 ? (
                          <div className="tracker-statement-section">
                            <h3>NPS ({stmt.npsHoldings.length}) · {formatInrFull(stmt.totalNpsValueInr)}</h3>
                            <div className="tracker-holdings-table-wrap">
                              <table className="tracker-holdings-table">
                                <thead>
                                  <tr>
                                    <th>AMC / PFM</th>
                                    <th>Scheme</th>
                                    <th>Tier</th>
                                    <th>Units</th>
                                    <th>Value</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {stmt.npsHoldings.map((h, i) => (
                                    <tr key={`${h.scheme_code}-${h.tier}-${i}`}>
                                      <td>{h.amc_name ?? h.pension_fund ?? "—"}</td>
                                      <td>{h.scheme_name ?? h.scheme_code ?? "—"}</td>
                                      <td>{h.tier}</td>
                                      <td>{h.units ?? "—"}</td>
                                      <td>{formatPrice(h.market_value_inr)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ) : null}

                        {holdingCount === 0 ? (
                          <p className="muted">No holdings parsed from this statement.</p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
