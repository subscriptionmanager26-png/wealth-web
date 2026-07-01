/**
 * Back-compat re-exports for imports like `from "./utils/casParser"`.
 * Canonical implementation: `parser/cas-parser.ts`.
 */

export type {
  CASCsvBundle,
  CASCsvOutput,
  Holding as CasHolding,
  MFDataItem,
  ParsedCAS as ParsedCas,
  PortfolioSummaryRow,
  Transaction as CasTx,
} from "../parser/cas-parser";

export {
  arrayBufferToBase64,
  base64ToArrayBuffer,
  buildCASCsv,
  enrichHoldingsWithMFData,
  parseCASBase64,
  parseCASBuffer,
  parseCASFromExtractedLines,
  parseCASText,
  parseCasFromPdfText,
} from "../parser/cas-parser";
