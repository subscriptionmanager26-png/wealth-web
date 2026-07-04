/**
 * Node.js entry: PDF bytes via pdfjs-dist → same parse pipeline as the app (after line extract).
 * Do not import this file from Expo `App.tsx` (keeps Metro from pulling pdfjs-dist into Hermes).
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { extractPdfLinesWithPdfJs } from "./extractPdfLinesPdfjs";
import { parseCASFromExtractedLines, type ParsedCAS } from "./cas-parser";

export async function parseCASBufferNode(
  buffer: ArrayBuffer,
  fileName = "cas.pdf",
  password?: string,
): Promise<ParsedCAS> {
  const lines = await extractPdfLinesWithPdfJs(buffer, password);
  return parseCASFromExtractedLines(lines, fileName);
}

export async function parseCASFile(filePath: string, password?: string): Promise<ParsedCAS> {
  const buf = await readFile(filePath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return parseCASBufferNode(ab, basename(filePath), password);
}

export type { ParsedCAS, UnitsReconciliation } from "./cas-parser";
export { verifyHoldingUnitReconciliation } from "./cas-parser";
