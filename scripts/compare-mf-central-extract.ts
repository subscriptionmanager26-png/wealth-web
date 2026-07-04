import { readFileSync } from "node:fs";
import { extractPdfLinesWithPdfJs as extractNode } from "../mobile-vendor/parser/extractPdfLinesPdfjs.ts";
import { parseMfCentralFromLines } from "../mobile-vendor/parser/mfCentralParser.ts";

/** Simulate browser pdfExtract line logic (hasEOL flush). */
async function extractWebStyle(buffer: ArrayBuffer, password?: string): Promise<string[]> {
  const { createRequire } = await import("node:module");
  const { dirname, join } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const require = createRequire(import.meta.url);
  const pdfRoot = dirname(require.resolve("pdfjs-dist/package.json"));
  const standardFontDataUrl = pathToFileURL(join(pdfRoot, "standard_fonts")).href + "/";
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(buffer);
  const pdf = await pdfjsLib.getDocument({ data, password, standardFontDataUrl, disableFontFace: true }).promise;
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
    const keys = Object.keys(buckets).map(Number).sort((a, b) => b - a);
    for (const k of keys) {
      const row = buckets[k].sort((a, b) => a.x - b.x);
      const buf: string[] = [];
      const flush = () => {
        if (buf.length) {
          const trimmed = buf.join(" ").replace(/\s+/g, " ").trim();
          if (trimmed) fullLines.push(trimmed);
          buf.length = 0;
        }
      };
      for (const cell of row) {
        buf.push(cell.s);
        if (cell.hasEOL) flush();
      }
      flush();
    }
  }
  return fullLines;
}

async function main() {
  const pdfPath = process.argv[2];
  const password = process.argv[3];
  if (!pdfPath) {
    console.error("Usage: npx tsx scripts/compare-mf-central-extract.ts <pdf> [password]");
    process.exit(1);
  }
  const buf = readFileSync(pdfPath);
  const abNode = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const abWeb = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const nodeLines = await extractNode(abNode, password);
  const webLines = await extractWebStyle(abWeb, password);
  console.log("lines node", nodeLines.length, "web", webLines.length);
  const node = parseMfCentralFromLines(nodeLines, "test.pdf");
  const web = parseMfCentralFromLines(webLines, "test.pdf");
  console.log("\nNODE:", {
    name: node.investor_name,
    pan: node.investor_pan,
    holdings: node.holdings.length,
    h0: node.holdings[0]?.scheme_name,
    h4: node.holdings[4]?.scheme_name,
  });
  console.log("\nWEB:", {
    name: web.investor_name,
    pan: web.investor_pan,
    holdings: web.holdings.length,
    h0: web.holdings[0]?.scheme_name,
    h4: web.holdings[4]?.scheme_name,
  });
  console.log("\n--- first 40 web lines ---");
  webLines.slice(0, 40).forEach((l, i) => console.log(String(i).padStart(4), l));
}

void main();
