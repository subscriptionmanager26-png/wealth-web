/**
 * Node / desktop only — not imported from the Expo app entry (keeps pdfjs-dist off Hermes bundles).
 * Mirrors the WebView line-reconstruction strategy (Y-buckets + X-sort).
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export async function extractPdfLinesWithPdfJs(buffer: ArrayBuffer, password?: string): Promise<string[]> {
  const require = createRequire(import.meta.url);
  const pdfRoot = dirname(require.resolve("pdfjs-dist/package.json"));
  const standardFontDataUrl = pathToFileURL(join(pdfRoot, "standard_fonts")).href + "/";

  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(buffer);
  const loadingTask = pdfjsLib.getDocument({
    data,
    password: password || undefined,
    standardFontDataUrl,
    disableFontFace: true,
  });
  const pdf = await loadingTask.promise;
  const fullLines: string[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });
    const vh = viewport.height;
    const eps = Math.max(2.5, Math.min(8, vh / 120));
    const buckets: Record<number, { x: number; s: string; hasEOL: boolean }[]> = {};

    for (const item of textContent.items) {
      if (!item || typeof item !== "object" || !("str" in item)) continue;
      const it = item as { str: string; transform: number[]; hasEOL?: boolean };
      if (!it.str) continue;
      const tr = it.transform;
      if (!tr || tr.length < 6) continue;
      const x = tr[4];
      const y = tr[5];
      const key = Math.round(y / eps) * eps;
      if (!buckets[key]) buckets[key] = [];
      buckets[key].push({ x, s: it.str, hasEOL: Boolean(it.hasEOL) });
    }

    const keys = Object.keys(buckets)
      .map(Number)
      .sort((a, b) => b - a);
    for (const k of keys) {
      const row = buckets[k].sort((a, b) => a.x - b.x);
      const buf: string[] = [];
      const flush = () => {
        if (buf.length) {
          fullLines.push(buf.join(" "));
          buf.length = 0;
        }
      };
      for (const c of row) {
        buf.push(c.s);
        if (c.hasEOL) flush();
      }
      flush();
    }
  }

  return fullLines;
}
