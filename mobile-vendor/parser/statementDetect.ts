import type { StatementKind } from "./statementTypes";

/** Detect statement family from extracted PDF text (mobile-safe, no PDF libs). */
export function detectStatementKind(text: string): StatementKind {
  const t = text.replace(/\s+/g, " ").toLowerCase();

  // NPS CRA transaction statement (check before CDSL — CDSL titles also mention NPS).
  if (
    t.includes("central record keeping agency") ||
    t.includes("central recordkeeping agency") ||
    (t.includes("national pension system") &&
      /\bpran\b/.test(t) &&
      (t.includes("tier 1 status") || t.includes("scheme_name e") || t.includes("tier 1 xirr")))
  ) {
    return "nps";
  }

  if (
    t.includes("central depository services") ||
    t.includes("cas@cdslindia.com") ||
    (t.includes("consolidated account statement") && t.includes("demat") && t.includes("cdsl"))
  ) {
    return "cdsl_cas";
  }

  // Other standalone NPS (PRAN-centric).
  if (
    (t.includes("national pension system") || t.includes("national pension scheme") || /\bpran\b/.test(t)) &&
    !t.includes("central depository services") &&
    (t.includes("nps trust") || t.includes("central recordkeeping") || t.includes("cra.nsdl") || t.includes("protean"))
  ) {
    return "nps";
  }

  if (
    t.includes("mutual fund consolidated account statement") ||
    (t.includes("summary of holdings as on") && t.includes("financial transactions during the period")) ||
    (t.includes("version-1025") && t.includes("mutual fund"))
  ) {
    return "mf_central";
  }

  // Existing CAMS / KFintech CAS (folio + registrar style).
  if (
    t.includes("consolidated account statement") &&
    (t.includes("cams") || t.includes("kfintech") || t.includes("karvy") || t.includes("folio no:"))
  ) {
    return "cams_kfin_cas";
  }

  if (t.includes("folio no") && (t.includes("opening unit balance") || t.includes("closing unit balance"))) {
    return "cams_kfin_cas";
  }

  return "unknown";
}
