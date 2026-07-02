/**
 * Persistent session diagnostics for mapping, NAV, storage, and network analysis.
 * Survives page refresh (localStorage ring buffer). No CAS PII — scheme codes and URLs only.
 */

import { safeLocalStorageRemove, safeLocalStorageSet } from "./safeLocalStorage";

export type DiagnosticsCategory =
  | "session"
  | "mapping"
  | "network"
  | "hydrate"
  | "storage"
  | "nav"
  | "parse"
  | "upload"
  | "chat";

const STORAGE_KEY = "wealth_web_diag_log_v1";
const SESSION_KEY = "wealth_web_diag_session_v1";
const MAX_LINES = 5_000;
const MAX_PERSIST_CHARS = 300_000;

function formatTs(d = new Date()): string {
  const p = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function loadPersistedLines(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistLines(lines: string[]): void {
  let blob = JSON.stringify(lines);
  while (blob.length > MAX_PERSIST_CHARS && lines.length > 100) {
    lines = lines.slice(Math.floor(lines.length * 0.1));
    blob = JSON.stringify(lines);
  }
  if (!safeLocalStorageSet(STORAGE_KEY, blob)) {
    lines = lines.slice(-500);
    safeLocalStorageSet(STORAGE_KEY, JSON.stringify(lines));
  }
}

function loadOrCreateSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return `sess_${Date.now().toString(36)}`;
  }
}

const listeners = new Set<Listener>();
let lines: string[] = loadPersistedLines();
export const diagnosticsSessionId = loadOrCreateSessionId();

export function subscribeDiagnostics(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const fn of listeners) fn();
}

export function getDiagnosticsText(): string {
  return lines.join("\n");
}

export function clearDiagnostics(): void {
  lines = [];
  safeLocalStorageRemove(STORAGE_KEY);
  notify();
}

export function appendDiagnosticsRawLine(line: string): void {
  lines.push(line);
  if (lines.length > MAX_LINES) {
    lines = lines.slice(-MAX_LINES);
  }
  persistLines(lines);
  notify();
}

export function diagLog(
  category: DiagnosticsCategory,
  message: string,
  detail?: Record<string, unknown>,
): void {
  const detailSuffix =
    detail && Object.keys(detail).length
      ? ` | ${JSON.stringify(detail)}`
      : "";
  const line = `[${formatTs()}] [${category.toUpperCase()}] [${diagnosticsSessionId}] ${message}${detailSuffix}`;
  lines.push(line);
  if (lines.length > MAX_LINES) {
    lines = lines.slice(-MAX_LINES);
  }
  persistLines(lines);
  notify();
}

export function logEnvironmentSnapshot(): void {
  const nav = typeof navigator !== "undefined" ? navigator : null;
  diagLog("session", "Environment snapshot", {
    url: typeof location !== "undefined" ? location.href : "",
    userAgent: nav?.userAgent ?? "",
    platform: nav?.platform ?? "",
    language: nav?.language ?? "",
    onLine: nav?.onLine ?? null,
    visibility: typeof document !== "undefined" ? document.visibilityState : "",
    screen: typeof screen !== "undefined" ? `${screen.width}x${screen.height}` : "",
    deviceMemory: (nav as Navigator & { deviceMemory?: number })?.deviceMemory ?? null,
    connection: (() => {
      const c = (nav as Navigator & { connection?: { effectiveType?: string; downlink?: number; rtt?: number } })
        ?.connection;
      if (!c) return null;
      return { effectiveType: c.effectiveType, downlink: c.downlink, rtt: c.rtt };
    })(),
    sessionId: diagnosticsSessionId,
  });
}

export function logPendingMappingSummary(label: string, docs: { holdings?: { mf_amfi_code?: string; scheme_name?: string; scheme_name_simple?: string; folio_no?: string }[] }[]): void {
  let mapped = 0;
  let pending = 0;
  let skipped = 0;
  const pendingSamples: string[] = [];
  for (const doc of docs) {
    for (const h of doc.holdings ?? []) {
      const open = Number(String(h as { opening_units?: string }).opening_units ?? 0);
      const close = Number(String((h as { closing_units?: string }).closing_units ?? 0));
      const txLen = ((h as { transactions?: unknown[] }).transactions ?? []).length;
      if (open === 0 && close === 0 && txLen === 0) {
        skipped += 1;
        continue;
      }
      if (String(h.mf_amfi_code ?? "").trim()) {
        mapped += 1;
      } else {
        pending += 1;
        if (pendingSamples.length < 12) {
          const name = (h.scheme_name_simple || h.scheme_name || "?").slice(0, 60);
          pendingSamples.push(`${h.folio_no || "—"}:${name}`);
        }
      }
    }
  }
  diagLog("mapping", label, { mapped, pending, skipped, pendingSamples });
}

export function downloadDiagnosticsFile(): void {
  const text = getDiagnosticsText();
  if (!text.trim()) return;
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `wealth-web-diagnostics-${diagnosticsSessionId}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}
