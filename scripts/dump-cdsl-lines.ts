import { readFile } from "node:fs/promises";
import { extractPdfLinesWithPdfJs } from "../mobile-vendor/parser/extractPdfLinesPdfjs";

async function main() {
  const file = process.argv[2]!;
  const buf = await readFile(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const lines = await extractPdfLinesWithPdfJs(ab, process.argv[3]);
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i]!;
    if (
      /HOLDING STATEMENT|Other Details|Lockin|Demat Remat|Portfolio Value|MUTUAL FUND UNITS/i.test(l) ||
      /IN[A-Z0-9]{10}/.test(l)
    ) {
      console.log(`${i + 1}\t${l}`);
    }
  }
}

main().catch(console.error);
