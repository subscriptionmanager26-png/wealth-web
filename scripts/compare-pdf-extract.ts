import { readFileSync } from "node:fs";
import { extractPdfLinesWithPdfJs as extractNode } from "../mobile-vendor/parser/extractPdfLinesPdfjs.ts";
import { extractPdfLinesWithPdfJs as extractWeb } from "../src/lib/pdfExtract.ts";

async function main() {
  const pdfPath = process.argv[2];
  const password = process.argv[3];
  if (!pdfPath) {
    console.error("Usage: npx tsx scripts/compare-pdf-extract.ts <pdf> [password]");
    process.exit(1);
  }
  const buf = readFileSync(pdfPath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const [nodeLines, webLines] = await Promise.all([
    extractNode(ab, password),
    extractWeb(ab, password),
  ]);
  console.log("node lines", nodeLines.length, "web lines", webLines.length);
  const start = 20;
  const end = 70;
  for (let i = start; i <= end; i++) {
    const n = nodeLines[i] ?? "(missing)";
    const w = webLines[i] ?? "(missing)";
    if (n !== w) console.log("DIFF", i, "\n  node:", n, "\n  web:", w);
  }
  console.log("--- web tier1 block ---");
  webLines.slice(20, 50).forEach((l, i) => console.log(String(i + 20).padStart(4), l));
}

void main();
