/**
 * Validate MF Central / CDSL / NPS parsers against a local PDF.
 *
 *   npx tsx scripts/test-statement-parsers.ts /path/to/file.pdf [password]
 *
 * Do not commit statement PDFs or passwords.
 */
import { parseStatementFile } from "../mobile-vendor/parser/statement-parser.node";

async function main() {
  const file = process.argv[2];
  const password = process.argv[3];
  if (!file) {
    console.error("Usage: npx tsx scripts/test-statement-parsers.ts <pdf> [password]");
    process.exit(1);
  }
  const result = await parseStatementFile(file, password);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
