/**
 * On-device AMFI scheme_code resolution for parsed CAS holdings.
 * - ISIN → scheme_code via bundled unique_schemes.csv (growth + dividend ISIN columns).
 * - If ISIN missing / unknown (or disabled): strict CSV-name shortlist narrowed by CAS labels.
 * - Disambiguation: CAS unit prices / closing valuation NAV vs mfapi.in NAV (4 dp, ±3 days);
 *   portal fallback when strict shortlist is empty.
 * - Persist resolved codes in AsyncStorage; reuse across uploads.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system/legacy";

import type { ParsedCAS } from "../parser/cas-parser";
import {
  AmfiRegistry,
  type ResolveAmfiOptions,
  resolveAmfiForParsedCasCore,
  shouldSkipAmfiResolution,
  type AmfiSchemeMapEntry,
  type AmfiSchemeMapStore,
} from "./amfiResolveCore";
import { MFAPI_RETRY_WAIT_MS, sleep } from "./mfapiBackoff";

export type { AmfiSchemeMapEntry, AmfiSchemeMapStore };

const STORE_KEY = "amfi_scheme_map_v1";

let registrySingleton: AmfiRegistry | null = null;
let registryLoadPromise: Promise<AmfiRegistry> | null = null;

async function loadBundledCsvText(): Promise<string> {
  const mod = require("../assets/unique_schemes.csv") as number;
  const asset = Asset.fromModule(mod);
  await asset.downloadAsync();
  const uri = asset.localUri;
  if (!uri) throw new Error("unique_schemes.csv asset has no localUri");
  return FileSystem.readAsStringAsync(uri);
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

/** Read the persisted ISIN / name-fingerprint → AMFI scheme_code map (for UI or debugging). */
export async function loadAmfiSchemeMapStore(): Promise<AmfiSchemeMapStore> {
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as AmfiSchemeMapStore;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function saveStore(store: AmfiSchemeMapStore): Promise<void> {
  await AsyncStorage.setItem(STORE_KEY, JSON.stringify(store));
}

/**
 * Mutates `parsed.holdings[*].mf_amfi_code` and merges new resolutions into AsyncStorage.
 */
export async function resolveAmfiForParsedCas(parsed: ParsedCAS, options?: ResolveAmfiOptions): Promise<void> {
  const [registry, store] = await Promise.all([getAmfiRegistry(), loadAmfiSchemeMapStore()]);
  const { dirty } = await resolveAmfiForParsedCasCore(parsed, registry, store, options);
  if (dirty) await saveStore(store);
}

/** Holdings that still need an AMFI code and are eligible for resolver work (mirrors core loop). */
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

/** Sum of {@link pendingResolvableAmfiCount} across every saved CAS document. */
export function totalPendingResolvableAmfiAcrossDocs(parsedDocs: ParsedCAS[]): number {
  let n = 0;
  for (const d of parsedDocs) n += pendingResolvableAmfiCount(d);
  return n;
}

/** True when most resolver-eligible holdings still lack AMFI codes (first NAV would be empty). */
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

/**
 * Runs AMFI resolution after CAS upload, then repeats the mfapi wait schedule (1m … 24h) and
 * re-resolves until every eligible holding has a code or a large wave cap is hit (safety valve).
 */
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

/**
 * Upload path: one local pass (ISIN / cache / strict name), then a short network pass for leftovers.
 * Does not sleep on mfapi backoff — that belongs to long-horizon retries, not upload.
 */
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
}
