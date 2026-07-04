/**
 * Node.js entry for MF Central / CDSL / NPS statements (pdfjs-dist).
 * Do not import from Expo App.tsx.
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { extractPdfLinesWithPdfJs } from "./extractPdfLinesPdfjs";
import { parseAnyStatementFromLines } from "./statementParser";

export async function parseStatementFile(filePath: string, password?: string) {
  const buf = await readFile(filePath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const lines = await extractPdfLinesWithPdfJs(ab, password);
  return parseAnyStatementFromLines(lines, basename(filePath));
}

export async function parseStatementBuffer(buffer: ArrayBuffer, fileName = "statement.pdf", password?: string) {
  const lines = await extractPdfLinesWithPdfJs(buffer, password);
  return parseAnyStatementFromLines(lines, fileName);
}
