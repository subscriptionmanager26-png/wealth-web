/**
 * Back-compat re-exports for statement parsers (MF Central, CDSL, NPS).
 */

export type {
  DematHoldingRow,
  DematTransactionRow,
  MfHoldingRow,
  NpsHoldingRow,
  NpsNominee,
  NpsTierSummary,
  ParsedCdslStatement,
  ParsedMfCentralStatement,
  ParsedNpsStatement,
  ParsedStatement,
  StatementKind,
  StatementTransaction,
} from "../parser/statementTypes";

export { detectStatementKind } from "../parser/statementDetect";
export {
  mfHoldingsToParsedCas,
  parseAnyStatementFromLines,
  parseStatementFromLines,
  parseStatementText,
} from "../parser/statementParser";
export { parseMfCentralFromLines, parseMfCentralText } from "../parser/mfCentralParser";
export { parseCdslFromLines, parseCdslText } from "../parser/cdslParser";
export { parseNpsFromLines, parseNpsHoldingsFromLines, parseNpsText } from "../parser/npsParser";
