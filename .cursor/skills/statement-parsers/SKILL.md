---
name: statement-parsers
description: >-
  Parse Indian investment statements (CAMS/KFin CAS, MF Central, CDSL demat CAS,
  NPS CRA) from PDF text lines using mobile-safe TypeScript parsers. Use when
  adding statement types, fixing parsers, wiring upload flows, or running the
  local statement demo for MF Central, CDSL, NPS, or CAMS PDFs.
---

# Statement parsers (wealth-web / mobile-vendor)

## Architecture (do not change)

Same stack as CAMS CAS:

1. **PDF → lines** via pdf.js (Node: `extractPdfLinesPdfjs.ts`; mobile: WebView `pdfTextBridge`)
2. **Lines → structured JSON** via pure TypeScript (Hermes-safe; no native PDF libs on device)
3. **Auto-detect** statement kind, then route to the right parser

Never put secrets, PANs, PRAN, emails, or statement PDFs in the repo. Parse in memory only.

## Source files

Canonical copies live under `mobile-vendor/parser/` (vendored from `pdf-parser/mobile-app/parser/`):

| File | Role |
|------|------|
| `statementDetect.ts` | Detect `cams_kfin_cas` \| `mf_central` \| `cdsl_cas` \| `nps` \| `unknown` |
| `statementParser.ts` | Unified entry: `parseAnyStatementFromLines`, `mfHoldingsToParsedCas` |
| `mfCentralParser.ts` | MF Central monthly MF CAS |
| `cdslParser.ts` | CDSL demat + MF folios (+ embedded NPS if PRAN present) |
| `npsParser.ts` | NPS CRA (Central Record Keeping Agency) Tier 1/2 |
| `statementTypes.ts` | Shared types |
| `statementUtils.ts` | Money/date/ISIN helpers (Indian number formats) |
| `statement-parser.node.ts` | Node entry with password support |
| `cas-parser.ts` | Existing CAMS/KFin CAS |
| `extractPdfLinesPdfjs.ts` | pdf.js line extraction (`password?`) |

Re-exports: `mobile-vendor/utils/statementParser.ts`

When editing parsers, change **`pdf-parser/mobile-app/parser/`** then run `npm run vendor-mobile` in wealth-web.

## Usage

```ts
import { parseAnyStatementFromLines } from "@mobile/utils/statementParser";
// or from mobile-vendor/utils/statementParser

const result = parseAnyStatementFromLines(lines, fileName);
// result.kind: cams_kfin_cas | mf_central | cdsl_cas | nps | unknown
```

Node / CLI:

```bash
# From mobile-app (source)
npx tsx scripts/test-statement-parsers.ts /path/to/file.pdf [PASSWORD]

# Local demo UI (in-memory only)
npm run statement-demo   # http://127.0.0.1:3847
```

Wealth-web demo:

```bash
npm run statement-demo   # scripts/statement-demo-server.ts
```

## Statement formats

### MF Central (`mf_central`)

- Title: "Mutual Fund Consolidated Account Statement"
- Holdings table: folio, ISIN, scheme, units, NAV, cost, gain%, market value
- Transaction blocks per folio (opening/closing balance + SIP/purchase rows)
- Password is usually PAN

### CDSL CAS (`cdsl_cas`)

- "Central Depository Services" + demat CAS
- Demat holdings (ISIN, qty, price, value) per BO ID
- MF folios section ("MUTUAL FUND UNITS HELD AS ON")
- May mention NPS in title without holdings — only parse NPS when **PRAN** is present

### NPS CRA (`nps`)

- "CENTRAL RECORD KEEPING AGENCY" / "NATIONAL PENSION SYSTEM"
- Columnar Tier 1 / Tier 2 blocks (`TIER 1 - Common Scheme`)
- Schemes E / C / G / A with allocation %, units, NAV, value, unrealised gain
- PRAN, POP, nominees, XIRR per tier

### CAMS / KFin (`cams_kfin_cas`)

- Existing `cas-parser.ts` — folio blocks, opening/closing unit balance, registrar

## Adding a new statement type

1. Extract sample with password via `extractPdfLinesWithPdfJs` (never commit the PDF or text dump).
2. Add detector branch in `statementDetect.ts` (order matters — NPS CRA before CDSL).
3. Implement `*Parser.ts` using `statementUtils` only.
4. Wire into `parseAnyStatementFromLines`.
5. Extend types in `statementTypes.ts`.
6. Validate with `scripts/test-statement-parsers.ts` / statement demo.
7. `npm run vendor-mobile` and commit **code only**.
8. **Delete** sample PDFs and `/tmp` extracts.

## Security rules

- Do not commit: statement PDFs, passwords, PAN/PRAN, emails, phones, addresses, raw extracted text, or parse JSON with PII.
- Demo server must keep PDFs in memory only (no disk writes).
- Prefer `mfHoldingsToParsedCas` when feeding MF holdings into the existing portfolio pipeline.

## Quick checks before shipping parser changes

1. Detector returns the correct `kind` for each sample family.
2. Holdings counts and totals match the PDF summary pages.
3. No sample PII appears in `git status` or the commit.
4. `npm run vendor-mobile` is current on wealth-web.
