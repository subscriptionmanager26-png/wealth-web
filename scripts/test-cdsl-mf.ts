import { readFile } from "node:fs/promises";
import { parseCdslFromLines } from "../mobile-vendor/parser/cdslParser";
import { extractPdfLinesWithPdfJs } from "../mobile-vendor/parser/extractPdfLinesPdfjs";

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: npx tsx scripts/test-cdsl-mf.ts <cdsl-pdf>");
    process.exit(1);
  }
  const buf = await readFile(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const lines = await extractPdfLinesWithPdfJs(ab);
  const r = parseCdslFromLines(lines, "test.pdf");
  const mf = r.mf_holdings;
  let sum = 0;
  console.log("mf count", mf.length);
  console.log("doc mf_folios_value_inr", r.mf_folios_value_inr);
  for (const [i, h] of mf.entries()) {
    const v = Number(String(h.market_value_inr ?? 0).replace(/,/g, ""));
    sum += v;
    console.log(
      `${i + 1}. ${h.isin} ${h.folio_no} | ${h.amc ?? "-"} | ${h.scheme_name ?? "-"} | ${h.market_value_inr}`,
    );
  }
  console.log("parsed sum", sum.toFixed(2));
  console.log("diff", (Number(r.mf_folios_value_inr) - sum).toFixed(2));
}

main().catch(console.error);
