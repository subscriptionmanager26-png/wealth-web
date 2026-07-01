import { useMemo, useState } from "react";

import type { ParsedCas } from "@mobile/utils/casParser";
import type { CasHolding } from "@mobile/utils/casParser";
import {
  buildCasPipelineSteps,
  formatIsoDateTime,
  pendingResolvableAmfiCount,
  statusColor,
  statusLabel,
  type CasPipelineMilestones,
} from "../lib/casPipeline";
import type { SavedParsedCasFile } from "../lib/casLibrary";
import { removeCasDoc } from "../lib/casLibrary";
import { exportSavedCasCsv, exportSavedCasRawText } from "../lib/casExport";
import {
  clearDiagnostics,
  diagnosticsSessionId,
  downloadDiagnosticsFile,
  getDiagnosticsText,
} from "../lib/diagnosticsLog";

type AccountTabProps = {
  savedCasFiles: SavedParsedCasFile[];
  savedParsedDocs: ParsedCas[];
  milestones: CasPipelineMilestones;
  uploadBusy: boolean;
  amfiMappingBusy: boolean;
  analyticsLoading: boolean;
  hydrating: boolean;
  holdingsCount: number;
  navStatus: "none" | "loading" | "ok" | "empty" | "error";
  navDetail?: string;
  amfiMappingLog: string;
  onRefreshNav: () => void;
  onRetryMapping: () => void;
  onRemoveCas: (id: string) => void;
  onUploadClick: () => void;
  onOpenSourceMapping: () => void;
};

export function AccountTab({
  savedCasFiles,
  savedParsedDocs,
  milestones,
  uploadBusy,
  amfiMappingBusy,
  analyticsLoading,
  hydrating,
  holdingsCount,
  navStatus,
  navDetail,
  amfiMappingLog,
  onRefreshNav,
  onRetryMapping,
  onRemoveCas,
  onUploadClick,
  onOpenSourceMapping,
}: AccountTabProps) {
  const [inspectId, setInspectId] = useState<string | null>(null);

  const pipeline = useMemo(
    () =>
      buildCasPipelineSteps({
        savedCasFiles,
        savedParsedDocs,
        milestones,
        uploadBusy,
        amfiMappingBusy,
        analyticsLoading,
        hydrating,
        holdingsCount,
        navStatus,
        navDetail,
      }),
    [
      savedCasFiles,
      savedParsedDocs,
      milestones,
      uploadBusy,
      amfiMappingBusy,
      analyticsLoading,
      hydrating,
      holdingsCount,
      navStatus,
      navDetail,
    ],
  );

  const inspectDoc = useMemo(() => {
    if (!inspectId) return null;
    const idx = savedCasFiles.findIndex((f) => f.id === inspectId);
    return idx >= 0 ? savedParsedDocs[idx] ?? null : null;
  }, [inspectId, savedCasFiles, savedParsedDocs]);

  const copyLog = async () => {
    const text = getDiagnosticsText();
    if (!text.trim()) return;
    await navigator.clipboard.writeText(text);
  };

  const lineCount = amfiMappingLog ? amfiMappingLog.split("\n").length : 0;

  return (
    <div className="tab-panel account-panel">
      <section className="panel-card">
        <h2 className="section-title">CAS pipeline status</h2>
        <p className="muted">
          Upload → save → parse → map scheme codes → compute portfolio NAV. Mapping runs in the background after upload.
        </p>
        <div className="pipeline-list">
          {pipeline.map((row) => (
            <div key={row.key} className="pipeline-row">
              <div className="pipeline-row-main">
                <strong>{row.title}</strong>
                {row.detail ? <p className="muted pipeline-detail">{row.detail}</p> : null}
              </div>
              <div className="pipeline-row-meta">
                <span style={{ color: statusColor(row.status), fontWeight: 700 }}>{statusLabel(row.status)}</span>
                <span className="muted pipeline-time">{formatIsoDateTime(row.at)}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel-card">
        <h2 className="section-title">Diagnostics log</h2>
        <p className="muted">
          Technical log for mapping, network calls, storage, and NAV. Persists across refresh on this device.
          Session: <code>{diagnosticsSessionId}</code> · {lineCount} lines
        </p>
        {amfiMappingBusy ? (
          <div className="loading-row">
            <span className="spinner" />
            <span>Source mapping in progress…</span>
          </div>
        ) : null}
        <textarea
          className="pipeline-log pipeline-log-tall"
          readOnly
          value={amfiMappingLog || (amfiMappingBusy ? "Logging…" : "Upload a CAS to capture diagnostics.")}
        />
        <div className="diag-log-actions">
          <button type="button" className="btn-secondary" onClick={() => void copyLog()} disabled={!amfiMappingLog.trim()}>
            Copy log
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => downloadDiagnosticsFile()}
            disabled={!amfiMappingLog.trim()}
          >
            Download .txt
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              clearDiagnostics();
            }}
            disabled={!amfiMappingLog.trim()}
          >
            Clear log
          </button>
        </div>
        <button
          type="button"
          className="btn-secondary"
          onClick={onRetryMapping}
          disabled={amfiMappingBusy || uploadBusy || hydrating}
        >
          {amfiMappingBusy ? "Mapping…" : "Retry source mapping"}
        </button>
        <button type="button" className="btn-secondary" onClick={onOpenSourceMapping}>
          View source mapping
        </button>
      </section>

      <section className="panel-card">
        <div className="section-head-row">
          <h2 className="section-title">Uploaded CAS files</h2>
          <button type="button" className="btn-secondary btn-sm" onClick={onUploadClick} disabled={uploadBusy}>
            Upload
          </button>
        </div>
        {!savedCasFiles.length ? (
          <p className="muted">No saved CAS files yet.</p>
        ) : (
          savedCasFiles.map((f, idx) => {
            const doc = savedParsedDocs[idx];
            const pending = doc ? pendingResolvableAmfiCount(doc) : 0;
            const mapped = doc ? (doc.holdings?.length ?? 0) - pending : 0;
            const total = doc?.holdings?.length ?? 0;
            return (
              <article key={f.id} className="cas-file-card">
                <div className="cas-file-head">
                  <div>
                    <strong>{f.name}</strong>
                    <p className="muted">{new Date(f.addedAt).toLocaleString()}</p>
                    {doc ? (
                      <p className="cas-file-status">
                        Scheme codes: {mapped}/{total} mapped
                        {pending > 0 ? ` · ${pending} pending` : ""}
                        {amfiMappingBusy && pending > 0 ? " (running…)" : ""}
                      </p>
                    ) : null}
                  </div>
                  <button type="button" className="btn-danger btn-sm" onClick={() => onRemoveCas(f.id)}>
                    Remove
                  </button>
                </div>
                <div className="cas-file-actions">
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => void exportSavedCasCsv(f).catch(() => undefined)}
                  >
                    Export CSV
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => void exportSavedCasRawText(f).catch(() => undefined)}
                  >
                    Export raw
                  </button>
                </div>
                <button type="button" className="link-btn" onClick={() => setInspectId(inspectId === f.id ? null : f.id)}>
                  {inspectId === f.id ? "Hide scheme fields" : "Show scheme fields"}
                </button>
                {inspectId === f.id && inspectDoc ? (
                  <div className="cas-inspect">
                    {(inspectDoc.holdings ?? []).map((h: CasHolding, i: number) => (
                      <div key={`${f.id}-${i}`} className="cas-inspect-row">
                        <p className="muted">Folio {(h.folio_no || "").trim() || "—"}</p>
                        <p>
                          <span className="inspect-label">Scheme</span> {(h.scheme_name || h.scheme_name_simple || "—").trim()}
                        </p>
                        <p>
                          <span className="inspect-label">ISIN</span> {(h.isin || "").trim() || "—"}
                        </p>
                        <p>
                          <span className="inspect-label">Scheme code</span> {(h.mf_amfi_code || "").trim() || "—"}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })
        )}
      </section>

      <section className="panel-card">
        <h2 className="section-title">Portfolio NAV</h2>
        {navStatus === "ok" && navDetail ? <p className="positive-text">{navDetail}</p> : null}
        {navStatus === "empty" || navStatus === "error" ? <p className="negative-text">{navDetail}</p> : null}
        <button type="button" className="btn-secondary" onClick={onRefreshNav} disabled={analyticsLoading || amfiMappingBusy}>
          {analyticsLoading ? "Working…" : "Refresh Portfolio NAV"}
        </button>
      </section>
    </div>
  );
}
