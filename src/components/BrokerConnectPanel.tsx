import { formatInrFull } from "../lib/format";
import { BROKER_LABELS, BROKERS, type BrokerId } from "../lib/brokers";
import type { BrokerConnectionState } from "../hooks/useBrokerMcp";
import type { SavedBrokerSync } from "../lib/brokerLibrary";

type BrokerConnectPanelProps = {
  states: Record<BrokerId, BrokerConnectionState>;
  brokerSyncs: SavedBrokerSync[];
  onAuthorize: (id: BrokerId) => void;
  onConnect: (id: BrokerId) => void;
  onDisconnect: (id: BrokerId) => void;
  onZerodhaLogin: (id: BrokerId) => void;
  onSync: (id: BrokerId) => void;
  onRemoveSync: (id: string) => void;
};

function BrokerCard({
  id,
  state,
  onAuthorize,
  onConnect,
  onDisconnect,
  onZerodhaLogin,
  onSync,
}: {
  id: BrokerId;
  state: BrokerConnectionState;
  onAuthorize: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onZerodhaLogin: () => void;
  onSync: () => void;
}) {
  const broker = BROKERS.find((b) => b.id === id)!;
  const needsOAuth = broker.auth === "oauth";
  const canConnect = !needsOAuth || state.authorized;

  return (
    <div className={`broker-card ${broker.supported ? "" : "broker-card-disabled"}`}>
      <div className="broker-card-head">
        <div>
          <strong>{broker.name}</strong>
          {!broker.supported ? <span className="broker-badge-soon">Coming soon</span> : null}
          {state.connected ? <span className="broker-badge-live">Connected</span> : null}
        </div>
        {broker.supported ? (
          <a href={broker.docs} target="_blank" rel="noopener noreferrer" className="broker-docs-link">
            Docs
          </a>
        ) : null}
      </div>

      {broker.supported ? (
        <>
          <p className="muted broker-card-steps">
            {id === "kite"
              ? "Connect → Login (Kite 2FA in browser) → Sync holdings"
              : "Authorize → Connect → Sync holdings by asset type"}
          </p>

          <div className="broker-card-actions">
            {needsOAuth && !state.connected ? (
              <button type="button" className="btn-secondary" onClick={onAuthorize} disabled={state.busy}>
                {state.authorized ? "Re-authorize" : "Authorize"}
              </button>
            ) : null}
            {!state.connected ? (
              <button
                type="button"
                className="btn-primary"
                onClick={onConnect}
                disabled={state.busy || !canConnect}
              >
                Connect
              </button>
            ) : (
              <>
                {id === "kite" ? (
                  <button type="button" className="btn-secondary" onClick={onZerodhaLogin} disabled={state.busy}>
                    Login on Kite
                  </button>
                ) : null}
                <button type="button" className="btn-primary" onClick={onSync} disabled={state.busy}>
                  Sync holdings
                </button>
                <button type="button" className="btn-text-danger" onClick={onDisconnect} disabled={state.busy}>
                  Disconnect
                </button>
              </>
            )}
          </div>

          {state.loginUrl ? (
            <div className="broker-login-banner">
              <p>Complete Zerodha login in your browser (2FA required).</p>
              <a href={state.loginUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary">
                Open Kite login
              </a>
            </div>
          ) : null}

          {state.status ? <p className="muted broker-status-text">{state.status}</p> : null}

          {state.lastSync ? (
            <p className="broker-sync-meta">
              Last sync: {state.lastSync.data.holdings.length} holdings ·{" "}
              {formatInrFull(state.lastSync.data.summary.totalValue)} ·{" "}
              {new Date(state.lastSync.syncedAt).toLocaleString()}
            </p>
          ) : null}
        </>
      ) : (
        <p className="muted">Broker MCP integration coming soon.</p>
      )}
    </div>
  );
}

export function BrokerConnectPanel({
  states,
  brokerSyncs,
  onAuthorize,
  onConnect,
  onDisconnect,
  onZerodhaLogin,
  onSync,
  onRemoveSync,
}: BrokerConnectPanelProps) {
  const expandedSyncId = brokerSyncs[0]?.id ?? null;

  return (
    <section className="panel-card broker-panel">
      <div className="section-head-row">
        <div>
          <h2 className="section-title">Broker connections</h2>
          <p className="muted">Live holdings via MCP — Zerodha and INDmoney supported today.</p>
        </div>
      </div>

      <div className="broker-card-grid">
        {BROKERS.map((b) => (
          <BrokerCard
            key={b.id}
            id={b.id}
            state={states[b.id]}
            onAuthorize={() => onAuthorize(b.id)}
            onConnect={() => onConnect(b.id)}
            onDisconnect={() => onDisconnect(b.id)}
            onZerodhaLogin={() => onZerodhaLogin(b.id)}
            onSync={() => onSync(b.id)}
          />
        ))}
      </div>

      {brokerSyncs.length > 0 ? (
        <div className="broker-sync-list">
          <h3 className="broker-sync-title">Live broker data</h3>
          {brokerSyncs.map((sync) => (
            <div key={sync.id} className="tracker-statement-block">
              <div className="tracker-statement-head">
                <div>
                  <strong>{BROKER_LABELS[sync.brokerId]} — {sync.label}</strong>
                  <div className="tracker-file-meta">
                    <span className="tracker-kind-badge">Live MCP</span>
                    <span className="tracker-period-badge">
                      Synced {new Date(sync.syncedAt).toLocaleString()}
                    </span>
                  </div>
                </div>
                <button type="button" className="btn-text-danger" onClick={() => onRemoveSync(sync.id)}>
                  Remove
                </button>
              </div>
              <div className="tracker-statement-body">
                <p className="muted">
                  {sync.data.holdings.length} holdings · {formatInrFull(sync.data.summary.totalValue)} total value
                </p>
                <div className="tracker-holdings-table-wrap">
                  <table className="tracker-holdings-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Type</th>
                        <th>Qty</th>
                        <th>Value</th>
                        <th>P&L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sync.data.holdings.slice(0, expandedSyncId === sync.id ? undefined : 15).map((h, i) => (
                        <tr key={`${h.code}-${h.name}-${i}`}>
                          <td>{h.name}</td>
                          <td>{h.assetType || h.subClass || "—"}</td>
                          <td>{h.units ? h.units.toLocaleString("en-IN") : "—"}</td>
                          <td>{formatInrFull(h.value)}</td>
                          <td>{formatInrFull(h.pnl)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {sync.data.holdings.length > 15 ? (
                  <p className="muted">Showing first 15 of {sync.data.holdings.length} holdings.</p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
