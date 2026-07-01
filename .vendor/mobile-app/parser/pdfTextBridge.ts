/**
 * Connects imperative PDF→text extraction (e.g. WebView PdfTextExtractor ref)
 * to library code that only has bytes/base64 (cas-parser.parseCASBuffer).
 */

export type PdfBase64Extractor = (base64Pdf: string, password?: string) => Promise<string>;

let extractor: PdfBase64Extractor | null = null;

export function registerPdfTextExtractor(fn: PdfBase64Extractor): void {
  extractor = fn;
}

export function unregisterPdfTextExtractor(): void {
  extractor = null;
}

export function isPdfTextExtractorRegistered(): boolean {
  return extractor !== null;
}

export async function extractTextFromPdfBase64(base64Pdf: string, password?: string): Promise<string> {
  if (!extractor) {
    throw new Error(
      "PDF text extractor not registered. From your root screen, call registerPdfTextExtractor(() => ref.current.extractText(...)) after mounting PdfTextExtractor."
    );
  }
  return extractor(base64Pdf, password);
}
