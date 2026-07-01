import { buildCASCsv, type ParsedCas } from "@mobile/utils/casParser";
import type { SavedParsedCasFile } from "./casLibrary";
import { loadParsedCasById } from "./casLibrary";

function downloadText(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportSavedCasCsv(file: SavedParsedCasFile): Promise<void> {
  const stored = await loadParsedCasById(file.id);
  if (!stored?.parsed) throw new Error("CAS file not found");
  const { portfolio_summary, holdings, transactions } = buildCASCsv(stored.parsed as ParsedCas);
  const combined = [portfolio_summary, holdings, transactions].filter(Boolean).join("\n\n");
  const base = file.name.replace(/\.pdf$/i, "") || "cas";
  downloadText(`${base}-export.csv`, combined, "text/csv;charset=utf-8");
}

export async function exportSavedCasRawText(file: SavedParsedCasFile): Promise<void> {
  const stored = await loadParsedCasById(file.id);
  if (!stored) throw new Error("CAS file not found");
  const text = stored.rawText ?? JSON.stringify(stored.parsed, null, 2);
  const base = file.name.replace(/\.pdf$/i, "") || "cas";
  downloadText(`${base}-raw.txt`, text, "text/plain;charset=utf-8");
}
