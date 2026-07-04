import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let pdfjsModulePromise: Promise<PdfJsModule> | null = null;

export class PdfPasswordRequiredError extends Error {
  constructor() {
    super("This PDF is password-protected.");
    this.name = "PdfPasswordRequiredError";
  }
}

export class PdfIncorrectPasswordError extends Error {
  constructor() {
    super("Incorrect password. Try again.");
    this.name = "PdfIncorrectPasswordError";
  }
}

function classifyPdfPasswordError(e: unknown): PdfPasswordRequiredError | PdfIncorrectPasswordError | null {
  const err = e as { name?: string; code?: number; message?: string };
  if (err?.name === "PasswordException") {
    return err.code === 2 ? new PdfIncorrectPasswordError() : new PdfPasswordRequiredError();
  }
  const msg = String(err?.message ?? e);
  if (/incorrect password|wrong password|invalid password/i.test(msg)) return new PdfIncorrectPasswordError();
  if (/password|encrypted|needpassword/i.test(msg)) return new PdfPasswordRequiredError();
  return null;
}

async function getPdfJs(): Promise<PdfJsModule> {
  if (!pdfjsModulePromise) {
    pdfjsModulePromise = import("pdfjs-dist/legacy/build/pdf.mjs").then((pdfjsLib) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      return pdfjsLib;
    });
  }
  return pdfjsModulePromise;
}

/** Browser PDF text extraction — same line-reconstruction strategy as mobile WebView / Node script. */
export async function extractPdfLinesWithPdfJs(buffer: ArrayBuffer, password?: string): Promise<string[]> {
  const pdfjsLib = await getPdfJs();
  const data = new Uint8Array(buffer);
  let pdf;
  try {
    const loadingTask = pdfjsLib.getDocument({
      data,
      disableFontFace: true,
      password: password?.trim() || undefined,
    });
    pdf = await loadingTask.promise;
  } catch (e) {
    const classified = classifyPdfPasswordError(e);
    if (classified) throw classified;
    throw e;
  }
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

export async function extractPdfTextFromFile(file: File, password?: string): Promise<string> {
  const buffer = await file.arrayBuffer();
  const lines = await extractPdfLinesWithPdfJs(buffer, password);
  return lines.join("\n");
}

export async function extractPdfLinesFromFile(file: File, password?: string): Promise<string[]> {
  const buffer = await file.arrayBuffer();
  return extractPdfLinesWithPdfJs(buffer, password);
}
