/**
 * Web AMFI scheme map — same logic as mobile; CSV loaded from /public via fetch.
 */
import asyncStorage from "../shims/async-storage";

import type { ParsedCAS } from "@mobile/parser/cas-parser";
import {
  AmfiRegistry,
  type ResolveAmfiOptions,
  resolveAmfiForParsedCasCore,
  shouldSkipAmfiResolution,
  type AmfiSchemeMapEntry,
  type AmfiSchemeMapStore,
} from "@mobile/utils/amfiResolveCore";
import { MFAPI_RETRY_WAIT_MS, sleep } from "@mobile/utils/mfapiBackoff";
import { diagLog } from "../lib/diagnosticsLog";

export type { AmfiSchemeMapEntry, AmfiSchemeMapStore };

const STORE_KEY = "amfi_scheme_map_v1";

let registrySingleton: AmfiRegistry | null = null;
let registryLoadPromise: Promise<AmfiRegistry> | null = null;

async function loadBundledCsvText(): Promise<string> {
  const res = await fetch("/unique_schemes.csv");
  if (!res.ok) throw new Error(`unique_schemes.csv fetch failed (${res.status})`);
  return res.text();
}

export async function getAmfiRegistry(): Promise<AmfiRegistry> {
  if (registrySingleton) return registrySingleton;
  if (!registryLoadPromise) {
    registryLoadPromise = (async () => {
      const text = await loadBundledCsvText();
      registrySingleton = AmfiRegistry.fromCsv(text);
      return registrySingleton;
    })();
  }
  return registryLoadPromise;
}

export async function loadAmfiSchemeMapStore(): Promise<AmfiSchemeMapStore> {
  try {
    const raw = await asyncStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as AmfiSchemeMapStore;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function saveStore(store: AmfiSchemeMapStore): Promise<void> {
  await asyncStorage.setItem(STORE_KEY, JSON.stringify(store));
}

export async function resolveAmfiForParsedCas(parsed: ParsedCAS, options?: ResolveAmfiOptions): Promise<void> {
  const [registry, store] = await Promise.all([getAmfiRegistry(), loadAmfiSchemeMapStore()]);
  const { dirty } = await resolveAmfiForParsedCasCore(parsed, registry, store, options);
  if (dirty) await saveStore(store);
}

export function pendingResolvableAmfiCount(parsed: ParsedCAS): number {
  let n = 0;
  for (const h of parsed.holdings ?? []) {
    if (shouldSkipAmfiResolution(h)) continue;
    if (String(h.mf_amfi_code ?? "").trim()) continue;
    const label = (h.scheme_name_simple || h.scheme_name || "").replace(/\s+/g, " ").trim();
    if (!label) continue;
    n += 1;
  }
  return n;
}

export function totalPendingResolvableAmfiAcrossDocs(parsedDocs: ParsedCAS[]): number {
  let n = 0;
  for (const d of parsedDocs) n += pendingResolvableAmfiCount(d);
  return n;
}

export function shouldDeferPortfolioNavUntilAmfiMapped(parsedDocs: ParsedCAS[]): boolean {
  let pending = 0;
  let mapped = 0;
  for (const doc of parsedDocs) {
    for (const h of doc.holdings ?? []) {
      if (shouldSkipAmfiResolution(h)) continue;
      const label = (h.scheme_name_simple || h.scheme_name || "").replace(/\s+/g, " ").trim();
      if (!label) continue;
      if (String(h.mf_amfi_code ?? "").trim()) mapped += 1;
      else pending += 1;
    }
  }
  if (pending === 0) return false;
  if (mapped === 0) return true;
  return pending > mapped;
}

export type ResolveAmfiProgressOptions = ResolveAmfiOptions & {
  onProgress?: () => void | Promise<void>;
};

export async function resolveAmfiForParsedCasWithBackoffUntilDone(
  parsed: ParsedCAS,
  options?: ResolveAmfiOptions,
): Promise<void> {
  await resolveAmfiForParsedCas(parsed, options);
  let prevMissing = pendingResolvableAmfiCount(parsed);
  let stagnantWaves = 0;
  for (let wave = 0; wave < 2000 && pendingResolvableAmfiCount(parsed) > 0; wave += 1) {
    for (const delayMs of MFAPI_RETRY_WAIT_MS) {
      if (pendingResolvableAmfiCount(parsed) === 0) return;
      await sleep(delayMs);
      await resolveAmfiForParsedCas(parsed, options);
    }
    const missing = pendingResolvableAmfiCount(parsed);
    if (missing === 0) return;
    if (missing >= prevMissing) stagnantWaves += 1;
    else stagnantWaves = 0;
    if (stagnantWaves >= 3) return;
    prevMissing = missing;
  }
}

export async function resolveAmfiForParsedCasAfterUpload(
  parsed: ParsedCAS,
  options?: ResolveAmfiProgressOptions,
): Promise<void> {
  const trace = options?.trace;
  let lastPending = Number.MAX_SAFE_INTEGER;
  const notifyIfChanged = async () => {
    const pending = pendingResolvableAmfiCount(parsed);
    if (pending === lastPending) return;
    lastPending = pending;
    trace?.appendNow(`Open holding lines after pass: ${pending}`);
    if (options?.onProgress) await options.onProgress();
  };

  trace?.appendNow("Source mapping session begin");
  diagLog("mapping", "resolveAmfiForParsedCasAfterUpload — pass 1 local");
  const localOpts: ResolveAmfiOptions = {
    ...options,
    networkDisambiguation: false,
    trace,
  };
  trace?.appendNow("Pass 1 — local (ISIN, cache, single strict name)");
  await resolveAmfiForParsedCas(parsed, localOpts);
  await notifyIfChanged();
  if (pendingResolvableAmfiCount(parsed) === 0) {
    trace?.appendNow("Source mapping session end — all lines mapped");
    return;
  }

  const networkOpts: ResolveAmfiOptions = {
    ...options,
    networkDisambiguation: true,
    trace,
  };
  for (let attempt = 1; attempt <= 2 && pendingResolvableAmfiCount(parsed) > 0; attempt += 1) {
    trace?.appendNow(`Pass ${attempt + 1} — network disambiguation`);
    diagLog("mapping", `resolveAmfiForParsedCasAfterUpload — network pass ${attempt + 1}`);
    await resolveAmfiForParsedCas(parsed, networkOpts);
    await notifyIfChanged();
    if (pendingResolvableAmfiCount(parsed) === 0) {
      trace?.appendNow("Source mapping session end — all lines mapped");
      return;
    }
  }

  const WEB_NETWORK_RETRY_MS = [3000, 8000, 15000];
  for (const delayMs of WEB_NETWORK_RETRY_MS) {
    if (pendingResolvableAmfiCount(parsed) === 0) {
      trace?.appendNow("Source mapping session end — all lines mapped");
      return;
    }
    trace?.appendNow(`Retry after ${Math.round(delayMs / 1000)}s — network disambiguation`);
    diagLog("mapping", `resolveAmfiForParsedCasAfterUpload — delayed retry`, { delayMs });
    await sleep(delayMs);
    await resolveAmfiForParsedCas(parsed, networkOpts);
    await notifyIfChanged();
    if (pendingResolvableAmfiCount(parsed) === 0) {
      trace?.appendNow("Source mapping session end — all lines mapped");
      return;
    }
  }

  trace?.appendNow(
    `Source mapping session end — ${pendingResolvableAmfiCount(parsed)} line(s) still unresolved`,
  );
  diagLog("mapping", "resolveAmfiForParsedCasAfterUpload — session end", {
    pending: pendingResolvableAmfiCount(parsed),
  });
}
