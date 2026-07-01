/**
 * React Native / Expo adapter for the CAS parser.
 *
 *   import { pickAndParseCAS } from './parser/cas-parser.rn';
 *   const result = await pickAndParseCAS();
 *
 * Requires registerPdfTextExtractor from a mounted PdfTextExtractor (see App.tsx).
 */

import type { DocumentPickerResult } from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";

import {
  buildCASCsv,
  enrichHoldingsWithMFData,
  parseCASBase64,
  parseCASBuffer,
  type MFDataItem,
  type ParsedCAS,
} from "./cas-parser";

const ISIN_CACHE_FILE = "mfdata-isin-cache.json";

async function enrichWithDiskCache(parsed: ParsedCAS, refresh?: boolean): Promise<void> {
  const path = `${FileSystem.documentDirectory ?? ""}${ISIN_CACHE_FILE}`;
  const disk: Record<string, MFDataItem | null> = {};
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (info.exists) {
      const raw = await FileSystem.readAsStringAsync(path);
      const p = JSON.parse(raw) as unknown;
      if (p && typeof p === "object") {
        for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
          disk[k] = v && typeof v === "object" ? (v as MFDataItem) : null;
        }
      }
    }
  } catch {
    /* empty cache */
  }
  const cache = new Map<string, MFDataItem | null>(Object.entries(disk));
  await enrichHoldingsWithMFData(parsed, { cache, refresh: refresh ?? false });
  const out: Record<string, unknown> = {};
  for (const [k, v] of cache) out[k] = v;
  await FileSystem.writeAsStringAsync(path, JSON.stringify(out, null, 2));
}

/**
 * Pick a CAS PDF via expo-document-picker, read it via expo-file-system,
 * and parse it using the core parser.
 */
export async function pickAndParseCAS(options: {
  enrich?: boolean;
  refreshMFData?: boolean;
  /** Passed to PDF.js when the CAS PDF is password-protected. */
  password?: string;
} = {}): Promise<ParsedCAS | null> {
  const DocumentPicker = await import("expo-document-picker");

  const result: DocumentPickerResult = await DocumentPicker.getDocumentAsync({
    type: "application/pdf",
    copyToCacheDirectory: true,
  });

  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];
  const uri: string = asset.uri;
  const fileName: string = asset.name ?? "cas.pdf";

  const base64: string = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const parsed = await parseCASBase64(base64, fileName, options.password);

  if (options.enrich) {
    await enrichWithDiskCache(parsed, options.refreshMFData);
  }

  return parsed;
}

/** Parse a CAS PDF from a URI already available in the app. */
export async function parseCASFromURI(
  uri: string,
  fileName = "cas.pdf",
  options: { enrich?: boolean; refreshMFData?: boolean; password?: string } = {}
): Promise<ParsedCAS> {
  const base64: string = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const parsed = await parseCASBase64(base64, fileName, options.password);

  if (options.enrich) {
    await enrichWithDiskCache(parsed, options.refreshMFData);
  }

  return parsed;
}

export { parseCASBuffer, arrayBufferToBase64, base64ToArrayBuffer } from "./cas-parser";
export type { ParsedCAS, UnitsReconciliation } from "./cas-parser";
export { enrichHoldingsWithMFData, buildCASCsv, verifyHoldingUnitReconciliation } from "./cas-parser";
export { registerPdfTextExtractor, unregisterPdfTextExtractor } from "./pdfTextBridge";
