import { readFileSync } from "node:fs";
import { extractPdfLinesWithPdfJs } from "../mobile-vendor/parser/extractPdfLinesPdfjs.ts";

async function main() {
  const pdfPath = process.argv[2];
  const password = process.argv[3];
  if (!pdfPath) {
    console.error("Usage: npx tsx scripts/dump-nps-lines.ts <pdf> [password]");
    process.exit(1);
  }
  const buf = readFileSync(pdfPath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const lines = await extractPdfLinesWithPdfJs(ab, password);
  lines.forEach((l, i) => {
    if (/scheme|pension|fund|HDFC|NPS|SCHEME|TIER|AMC|PFM|Equity|Corporate|Government/i.test(l)) {
      console.log(String(i).padStart(4), l);
    }
  });
}

void main();
