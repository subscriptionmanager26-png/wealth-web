import { useEffect, useState } from "react";

import { loadAmfiSchemeMapStore } from "@mobile/utils/amfiSchemeMap";

function formatAmfiStoreKeyLabel(storeKey: string): string {
  if (storeKey.startsWith("i:")) return `ISIN ${storeKey.slice(2)}`;
  if (storeKey.startsWith("n:")) {
    const rest = storeKey.slice(2);
    const i = rest.indexOf(":");
    if (i < 0) return rest;
    const folio = rest.slice(0, i) || "—";
    const slug = rest.slice(i + 1).replace(/_/g, " ");
    return `Folio ${folio} · ${slug}`;
  }
  return storeKey;
}

type HoldingRow = { id: string; name: string; rawName: string; amfiCode?: string };

type SourceMappingModalProps = {
  open: boolean;
  onClose: () => void;
  holdings: HoldingRow[];
};

export function SourceMappingModal({ open, onClose, holdings }: SourceMappingModalProps) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<[string, { code: string; by: string; updatedAt: string }][]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void loadAmfiSchemeMapStore()
      .then((store) => {
        if (cancelled) return;
        const entries = Object.entries(store).sort(([a], [b]) => a.localeCompare(b));
        setRows(entries);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const mappedHoldings = holdings.filter((h) => h.amfiCode).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card modal-card-tall" onClick={(e) => e.stopPropagation()}>
        <h3>Source mapping</h3>
        <p className="muted">
          {loading ? "Loading…" : `${rows.length} entr${rows.length === 1 ? "y" : "ies"} on this device`}
        </p>
        <div className="amfi-map-scroll">
          {!loading && rows.length === 0 ? (
            <p className="muted">No mappings yet. Upload a CAS; new schemes get resolved and appear here.</p>
          ) : null}
          {rows.map(([key, v]) => (
            <div key={key} className="amfi-map-block">
              <p className="amfi-map-key">{formatAmfiStoreKeyLabel(key)}</p>
              <p>
                <span className="muted">Code </span>
                <strong>{v.code}</strong>
                <span className="muted"> · </span>
                <span>{v.by === "isin" ? "ISIN table" : v.by === "nav" ? "Name + NAV" : "Name"}</span>
              </p>
              <p className="caption">{new Date(v.updatedAt).toLocaleString()}</p>
            </div>
          ))}
          <h4 className="section-title" style={{ marginTop: 16 }}>
            Current portfolio (merged)
          </h4>
          {!mappedHoldings.length ? (
            <p className="muted">No scheme codes on aggregated holdings yet.</p>
          ) : (
            mappedHoldings.map((h) => (
              <div key={h.id} className="amfi-map-block">
                <p className="amfi-map-key">{h.name}</p>
                <p>
                  <span className="muted">Code </span>
                  <strong>{h.amfiCode}</strong>
                </p>
              </div>
            ))
          )}
        </div>
        <button type="button" className="btn-secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
