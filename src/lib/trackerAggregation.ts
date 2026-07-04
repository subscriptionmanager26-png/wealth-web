import type { DematHoldingRow, MfHoldingRow, NpsHoldingRow } from "@mobile/utils/statementParser";
import type { SavedTrackerFile, StoredTrackerPayload, TrackerStatementKind } from "./trackerLibrary";

export type TrackerMfRow = MfHoldingRow & {
  sourceFile: string;
  sourceKind: TrackerStatementKind;
};

export type TrackerDematRow = DematHoldingRow & {
  sourceFile: string;
};

export type TrackerNpsRow = NpsHoldingRow & {
  sourceFile: string;
};

export type TrackerStatementView = {
  file: SavedTrackerFile;
  mfHoldings: TrackerMfRow[];
  dematHoldings: TrackerDematRow[];
  lockedDematHoldings: TrackerDematRow[];
  npsHoldings: TrackerNpsRow[];
  totalMfValueInr: number;
  totalDematValueInr: number;
  totalNpsValueInr: number;
};

export type TrackerCombinedView = {
  statementCount: number;
  mfHoldings: TrackerMfRow[];
  dematHoldings: TrackerDematRow[];
  lockedDematHoldings: TrackerDematRow[];
  npsHoldings: TrackerNpsRow[];
  investors: string[];
  totalMfValueInr: number;
  totalDematValueInr: number;
  totalNpsValueInr: number;
};

function parseInr(value: string | null | undefined): number {
  if (!value) return 0;
  const n = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function casHoldingToMfRow(
  h: {
    amc: string | null;
    folio_no: string;
    scheme_name: string | null;
    isin: string | null;
    scheme_code: string | null;
    closing_units: string | null;
    nav_inr: string | null;
    cost_value_inr: string | null;
    market_value_inr: string | null;
  },
  sourceFile: string,
): MfHoldingRow {
  return {
    amc: h.amc,
    folio_no: h.folio_no,
    isin: h.isin,
    scheme_code: h.scheme_code,
    scheme_name: h.scheme_name,
    closing_units: h.closing_units,
    nav_inr: h.nav_inr,
    cost_value_inr: h.cost_value_inr,
    market_value_inr: h.market_value_inr,
    gain_pct: null,
    plan_tag: null,
    transactions: [],
  };
}

function payloadToStatementRows(
  payload: StoredTrackerPayload,
  sourceFile: string,
): Pick<TrackerStatementView, "mfHoldings" | "dematHoldings" | "lockedDematHoldings" | "npsHoldings"> {
  const mfHoldings: TrackerMfRow[] = [];
  const dematHoldings: TrackerDematRow[] = [];
  const lockedDematHoldings: TrackerDematRow[] = [];
  const npsHoldings: TrackerNpsRow[] = [];

  switch (payload.kind) {
    case "cams_kfin_cas":
      for (const h of payload.data.holdings ?? []) {
        mfHoldings.push({
          ...casHoldingToMfRow(h, sourceFile),
          sourceFile,
          sourceKind: payload.kind,
        });
      }
      break;
    case "mf_central":
      for (const h of payload.data.holdings) {
        mfHoldings.push({ ...h, sourceFile, sourceKind: payload.kind });
      }
      break;
    case "cdsl_cas":
      for (const h of payload.data.mf_holdings) {
        mfHoldings.push({ ...h, sourceFile, sourceKind: payload.kind });
      }
      for (const h of payload.data.demat_holdings) {
        dematHoldings.push({ ...h, sourceFile });
      }
      for (const h of payload.data.locked_demat_holdings ?? []) {
        lockedDematHoldings.push({ ...h, sourceFile });
      }
      for (const h of payload.data.nps_holdings) {
        npsHoldings.push({ ...h, sourceFile });
      }
      break;
    case "nps":
      for (const h of payload.data.holdings) {
        npsHoldings.push({ ...h, sourceFile });
      }
      break;
  }

  return { mfHoldings, dematHoldings, lockedDematHoldings, npsHoldings };
}

export function buildTrackerStatementView(file: SavedTrackerFile, payload: StoredTrackerPayload): TrackerStatementView {
  const sourceFile = payload.data.source_file;
  const rows = payloadToStatementRows(payload, sourceFile);
  return {
    file,
    ...rows,
    totalMfValueInr: rows.mfHoldings.reduce((sum, h) => sum + parseInr(h.market_value_inr), 0),
    totalDematValueInr: rows.dematHoldings.reduce((sum, h) => sum + parseInr(h.market_value_inr), 0),
    totalNpsValueInr: rows.npsHoldings.reduce((sum, h) => sum + parseInr(h.market_value_inr), 0),
  };
}

export function buildTrackerStatementViews(
  entries: { file: SavedTrackerFile; payload: StoredTrackerPayload }[],
): TrackerStatementView[] {
  return entries.map(({ file, payload }) => buildTrackerStatementView(file, payload));
}

export function aggregateTrackerStatements(payloads: StoredTrackerPayload[]): TrackerCombinedView {
  const mfHoldings: TrackerMfRow[] = [];
  const dematHoldings: TrackerDematRow[] = [];
  const lockedDematHoldings: TrackerDematRow[] = [];
  const npsHoldings: TrackerNpsRow[] = [];
  const investorSet = new Set<string>();

  for (const payload of payloads) {
    const sourceFile = payload.data.source_file;
    const name = payload.data.investor_name?.trim();
    if (name) investorSet.add(name);

    const rows = payloadToStatementRows(payload, sourceFile);
    mfHoldings.push(...rows.mfHoldings);
    dematHoldings.push(...rows.dematHoldings);
    lockedDematHoldings.push(...rows.lockedDematHoldings);
    npsHoldings.push(...rows.npsHoldings);
  }

  return {
    statementCount: payloads.length,
    mfHoldings,
    dematHoldings,
    lockedDematHoldings,
    npsHoldings,
    investors: [...investorSet],
    totalMfValueInr: mfHoldings.reduce((sum, h) => sum + parseInr(h.market_value_inr), 0),
    totalDematValueInr: dematHoldings.reduce((sum, h) => sum + parseInr(h.market_value_inr), 0),
    totalNpsValueInr: npsHoldings.reduce((sum, h) => sum + parseInr(h.market_value_inr), 0),
  };
}

export const TRACKER_KIND_LABELS: Record<TrackerStatementKind, string> = {
  cams_kfin_cas: "CAMS / KFintech",
  mf_central: "MF Central",
  cdsl_cas: "CDSL CAS",
  nps: "NPS",
};
