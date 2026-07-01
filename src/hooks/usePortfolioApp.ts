import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ParsedCas } from "@mobile/utils/casParser";
import { createDiagnosticsMappingTrace } from "../lib/diagnosticsTrace";
import {
  buildPortfolioAnalyticsForParsedDocs,
  warmPortfolioNavHistoryCache,
  type PortfolioAnalyticsSnapshot,
} from "@mobile/utils/portfolioNavAnalytics";
import {
  buildPortfolioFundamentalsSnapshot,
  loadPortfolioInsightsForHoldings,
} from "@mobile/utils/portfolioInsightsAnalytics";
import { buildXRayHoldings, buildXRaySectors } from "@mobile/utils/xrayAggregations";
import { buildFundSellInsights } from "@mobile/utils/fundSellInsights";
import {
  loadBenchmarkDailyNav,
  loadBenchmarkMonthEndNav,
  warmBenchmarkData,
} from "../bridge/benchmarkService.web";
import {
  pendingResolvableAmfiCount,
  resolveAmfiForParsedCasAfterUpload,
  totalPendingResolvableAmfiAcrossDocs,
} from "../bridge/amfiSchemeMap.web";
import type { BenchmarkId, BenchmarkMonthEndPoint } from "@mobile/utils/benchmarkTypes";
import type { UpvalySchemeDetail } from "@mobile/utils/upvalyMfApi";
import { parseCasFromPdfText } from "@mobile/utils/casParser";

import { buildHoldingsFromParsedFiles, type FundHolding, type Profile } from "../lib/buildHoldings";
import {
  loadAllParsedDocs,
  listCasIndex,
  loadParsedCasById,
  removeCasDoc,
  saveParsedCas,
  type SavedParsedCasFile,
  updateParsedCas,
} from "../lib/casLibrary";
import { extractPdfTextFromFile } from "../lib/pdfExtract";
import { formatPct } from "../lib/format";
import { Wealth } from "../theme/wealthTheme";
import { loadPipelineMilestones, savePipelineMilestones, type CasPipelineMilestones } from "../lib/casPipeline";
import { singleFlight } from "../lib/singleFlight";
import {
  createManualMember,
  loadManualProfiles,
  mergeCasAndManualProfiles,
  saveManualProfiles,
} from "../lib/manualProfiles";
import { mergeUniqueInvestorsFromCasDocs } from "@mobile/utils/casInvestorProfiles";
import {
  familyNavLooksReady,
  isPortfolioNavCacheWithinRefreshWindow,
  nextAmfiAutoRetryMilestones,
  shouldRefreshPortfolioNav,
  shouldRetryAmfiMapping,
} from "../lib/portfolioNavSchedule";
import {
  clearPortfolioNavComputedToday,
  markAmfiHydrateAttemptedToday,
  markPortfolioNavComputedToday,
  wasPortfolioNavComputedToday,
} from "../lib/portfolioNavSession";
import {
  loadCachedPortfolioAnalytics,
  saveCachedPortfolioAnalytics,
} from "../bridge/portfolioNavCache.web";
import {
  appendDiagnosticsRawLine,
  diagLog,
  getDiagnosticsText,
  logPendingMappingSummary,
  subscribeDiagnostics,
} from "../lib/diagnosticsLog";

export type HomeTabId = "overview" | "analysis" | "insights" | "funds";
export type BottomTabId = "home" | "screener" | "ai" | "account";

export type Toast = { kind: "success" | "error"; text: string };

const AMFI_RESOLUTION_SKIP_ISIN = false;

/** Shared in-flight guards across React StrictMode remounts. */
const appSession = {
  amfiAllBusy: false,
  amfiSlotBusy: false,
  amfiQueue: [] as string[],
  navAnalyticsFlight: { current: null as Promise<void> | null },
  hydrateFlight: { current: null as Promise<void> | null },
};

export function usePortfolioApp() {
  const [bottomTab, setBottomTab] = useState<BottomTabId>("home");
  const [homeTab, setHomeTab] = useState<HomeTabId>("overview");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [holdings, setHoldings] = useState<FundHolding[]>([]);
  const [familyXirr, setFamilyXirr] = useState("0.0%");
  const [savedParsedDocs, setSavedParsedDocs] = useState<ParsedCas[]>([]);
  const [savedCasFiles, setSavedCasFiles] = useState<SavedParsedCasFile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string>("family");
  const [portfolioAnalytics, setPortfolioAnalytics] = useState<Record<string, PortfolioAnalyticsSnapshot>>({});
  const [benchmarkMonthEnds, setBenchmarkMonthEnds] = useState<
    Partial<Record<BenchmarkId, BenchmarkMonthEndPoint[]>>
  >({});
  const [benchmarkDailyNav, setBenchmarkDailyNav] = useState<
    Partial<Record<BenchmarkId, BenchmarkMonthEndPoint[]>>
  >({});
  const [upvalySchemes, setUpvalySchemes] = useState<Record<string, UpvalySchemeDetail>>({});
  const [upvalyInsightsLoading, setUpvalyInsightsLoading] = useState(false);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [hydrating, setHydrating] = useState(true);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [amfiMappingBusy, setAmfiMappingBusy] = useState(false);
  const [pipelineStatus, setPipelineStatus] = useState("");
  const [pipelineMilestones, setPipelineMilestones] = useState<CasPipelineMilestones>(() => loadPipelineMilestones());
  const [amfiMappingLog, setAmfiMappingLog] = useState(() => getDiagnosticsText());
  const [portfolioNavStatus, setPortfolioNavStatus] = useState<{
    kind: "none" | "loading" | "ok" | "empty" | "error";
    detail?: string;
  }>({ kind: "none" });
  const [toast, setToast] = useState<Toast | null>(null);

  const amfiSlotBusyRef = useRef(appSession.amfiSlotBusy);
  const amfiQueueRef = useRef(appSession.amfiQueue);
  const amfiAllBusyRef = useRef(appSession.amfiAllBusy);

  useEffect(() => {
    let timer: number | null = null;
    return subscribeDiagnostics(() => {
      if (timer != null) return;
      timer = window.setTimeout(() => {
        timer = null;
        const text = getDiagnosticsText();
        setAmfiMappingLog(text.length > 50_000 ? text.slice(-50_000) : text);
      }, 200);
    });
  }, []);

  const rebuildFromDocs = useCallback(async (docs: ParsedCas[], options?: { skipLiveNav?: boolean }) => {
    const built = await buildHoldingsFromParsedFiles(docs, { skipLiveNav: options?.skipLiveNav });
    const mergedProfiles = mergeCasAndManualProfiles(built.profiles, loadManualProfiles());
    setProfiles(mergedProfiles);
    setHoldings(built.holdings);
    setFamilyXirr(built.familyXirr);
    setSavedParsedDocs(docs);
    return { ...built, profiles: mergedProfiles };
  }, []);

  const applyPortfolioNavCacheToState = useCallback(
    (cached: NonNullable<Awaited<ReturnType<typeof loadCachedPortfolioAnalytics>>>, reason: string) => {
      const ok = familyNavLooksReady(cached.byProfile);
      diagLog("nav", "Restored portfolio NAV from cache", {
        reason,
        familyPoints: cached.byProfile.family?.points.length ?? 0,
        cacheUpdatedAt: cached.updatedAt,
        ok,
      });
      setPortfolioAnalytics(cached.byProfile);
      setPortfolioNavStatus(
        ok
          ? {
              kind: "ok",
              detail: `Portfolio NAV from cache (${cached.byProfile.family!.points.length} points, ${reason})`,
            }
          : { kind: "empty", detail: "Cached portfolio NAV is incomplete." },
      );
      markPortfolioNavComputedToday();
      setPipelineMilestones((prev) => {
        const next = { ...prev, navFinishedAt: cached.updatedAt };
        savePipelineMilestones(next);
        return next;
      });
    },
    [],
  );

  const syncPortfolioNavCacheFromDisk = useCallback(async (): Promise<{
    applied: boolean;
    skipNetwork: boolean;
  }> => {
    const cached = await loadCachedPortfolioAnalytics();

    if (!cached) {
      if (wasPortfolioNavComputedToday()) {
        diagLog("hydrate", "Clearing orphaned portfolio NAV session flag (no device cache)");
        clearPortfolioNavComputedToday();
      }
      return { applied: false, skipNetwork: false };
    }

    const decision = shouldRefreshPortfolioNav(cached.updatedAt);
    const hasData = familyNavLooksReady(cached.byProfile);

    if (hasData) {
      diagLog("nav", "Restored portfolio NAV from device cache", {
        reason: decision.reason,
        familyPoints: cached.byProfile.family?.points.length ?? 0,
        cacheUpdatedAt: cached.updatedAt,
        skipNetwork: !decision.refresh,
      });
      applyPortfolioNavCacheToState(cached, decision.reason);
    } else {
      diagLog("nav", "Device cache exists but portfolio NAV series is incomplete", {
        cacheUpdatedAt: cached.updatedAt,
        profileIds: Object.keys(cached.byProfile),
      });
    }

    return { applied: hasData, skipNetwork: hasData && !decision.refresh };
  }, [applyPortfolioNavCacheToState]);

  const tryRestorePortfolioNavFromCache = useCallback(async (): Promise<boolean> => {
    const { skipNetwork } = await syncPortfolioNavCacheFromDisk();
    return skipNetwork;
  }, [syncPortfolioNavCacheFromDisk]);

  const runPortfolioNavAnalytics = useCallback(
    async (parsedDocs: ParsedCas[], options?: { force?: boolean }) => {
      return singleFlight(appSession.navAnalyticsFlight, async () => {
        if (!parsedDocs.length) {
          setPortfolioAnalytics({});
          setPortfolioNavStatus({ kind: "none" });
          return;
        }

        if (!options?.force) {
          const cached = await loadCachedPortfolioAnalytics();
          if (cached && familyNavLooksReady(cached.byProfile)) {
            if (isPortfolioNavCacheWithinRefreshWindow(cached.updatedAt)) {
              applyPortfolioNavCacheToState(
                cached,
                `portfolio NAV cached within 24h (${cached.updatedAt})`,
              );
              return;
            }
            const decision = shouldRefreshPortfolioNav(cached.updatedAt);
            if (!decision.refresh) {
              applyPortfolioNavCacheToState(cached, decision.reason);
              return;
            }
            applyPortfolioNavCacheToState(cached, `${decision.reason} — refreshing`);
          } else if (wasPortfolioNavComputedToday()) {
            clearPortfolioNavComputedToday();
          }
        }

        setAnalyticsLoading(true);
        setPortfolioNavStatus({ kind: "loading" });
        diagLog("nav", "Portfolio NAV analytics started", {
          docCount: parsedDocs.length,
          force: options?.force ?? false,
        });
        try {
          await warmPortfolioNavHistoryCache(parsedDocs, new Date());
          const byProfile = await buildPortfolioAnalyticsForParsedDocs(parsedDocs, new Date());
          setPortfolioAnalytics(byProfile);
          const navSavedAt = await saveCachedPortfolioAnalytics(byProfile);
          markPortfolioNavComputedToday(); // only after IndexedDB save succeeds
          const family = byProfile.family;
          if (familyNavLooksReady(byProfile)) {
            diagLog("nav", "Portfolio NAV analytics OK", {
              familyPoints: family!.points.length,
              navSavedAt,
            });
            setPipelineMilestones((prev) => {
              const next = { ...prev, navFinishedAt: navSavedAt };
              savePipelineMilestones(next);
              return next;
            });
            setPortfolioNavStatus({
              kind: "ok",
              detail: `${family!.points.length} month-end NAV point(s) computed`,
            });
          } else {
            diagLog("nav", "Portfolio NAV analytics empty — insufficient series", {
              profileIds: Object.keys(byProfile),
            });
            setPortfolioNavStatus({ kind: "empty", detail: "No NAV series — check scheme code mapping." });
          }
        } catch (e) {
          diagLog("nav", "Portfolio NAV analytics error", { error: String(e) });
          setPortfolioNavStatus({ kind: "error", detail: String(e) });
        } finally {
          setAnalyticsLoading(false);
        }
      });
    },
    [applyPortfolioNavCacheToState],
  );

  const applyPortfolioNavCacheIfFresh = useCallback(async (): Promise<boolean> => {
    return tryRestorePortfolioNavFromCache();
  }, [tryRestorePortfolioNavFromCache]);

  const schedulePortfolioNavIfNeeded = useCallback(
    async (
      parsedDocs: ParsedCas[],
      trigger: "hydrate" | "cas-upload" | "amfi-mapped" | "cas-change" | "manual",
    ) => {
      const forceRun = trigger === "cas-upload" || trigger === "cas-change" || trigger === "manual";

      if (!parsedDocs.length) {
        if (trigger !== "hydrate" || !(await applyPortfolioNavCacheIfFresh())) {
          setPortfolioAnalytics({});
          setPortfolioNavStatus({ kind: "none" });
        }
        return;
      }

      if (!forceRun) {
        const cached = await loadCachedPortfolioAnalytics();
        if (cached?.updatedAt && familyNavLooksReady(cached.byProfile)) {
          if (isPortfolioNavCacheWithinRefreshWindow(cached.updatedAt)) {
            applyPortfolioNavCacheToState(
              cached,
              `portfolio NAV cached within 24h (${cached.updatedAt})`,
            );
            return;
          }
          const decision = shouldRefreshPortfolioNav(cached.updatedAt);
          if (!decision.refresh) {
            applyPortfolioNavCacheToState(cached, decision.reason);
            return;
          }
          applyPortfolioNavCacheToState(cached, `${decision.reason} — refreshing`);
        } else if (wasPortfolioNavComputedToday()) {
          clearPortfolioNavComputedToday();
        }

        const pendingAmfi = totalPendingResolvableAmfiAcrossDocs(parsedDocs);
        if (pendingAmfi > 0) {
          diagLog("nav", "Deferred portfolio NAV refresh — pending scheme mapping", { pendingAmfi, trigger });
          return;
        }

        if (!cached) return;
      }

      await runPortfolioNavAnalytics(parsedDocs, { force: forceRun });
    },
    [applyPortfolioNavCacheIfFresh, applyPortfolioNavCacheToState, runPortfolioNavAnalytics],
  );

  const refreshLibraryState = useCallback(
    async (options?: { skipLiveNav?: boolean }) => {
      const [index, docs] = await Promise.all([listCasIndex(), loadAllParsedDocs()]);
      setSavedCasFiles((prev) => {
        if (
          prev.length === index.length &&
          prev.every((f, i) => f.id === index[i]?.id && f.addedAt === index[i]?.addedAt)
        ) {
          return prev;
        }
        return index;
      });
      await rebuildFromDocs(docs, { skipLiveNav: options?.skipLiveNav });
      return { index, docs };
    },
    [rebuildFromDocs],
  );

  const runAmfiMappingForDoc = useCallback(
    async (docId: string, navTrigger: "cas-upload" | "amfi-mapped" = "amfi-mapped") => {
      if (amfiSlotBusyRef.current) {
        if (!amfiQueueRef.current.includes(docId)) amfiQueueRef.current.push(docId);
        diagLog("mapping", "Mapping queued — slot busy", { docId, queueLen: amfiQueueRef.current.length });
        return;
      }
      amfiSlotBusyRef.current = true;
      appSession.amfiSlotBusy = true;
      setAmfiMappingBusy(true);

      const trace = createDiagnosticsMappingTrace((line) => {
        appendDiagnosticsRawLine(line);
      });

      try {
        const stored = await loadParsedCasById(docId);
        if (!stored) {
          diagLog("mapping", "Mapping aborted — CAS doc not found in IndexedDB", { docId });
          return;
        }
        const parsed = stored.parsed;
        const index = await listCasIndex();
        const fileName = index.find((f) => f.id === docId)?.name ?? "cas.pdf";
        const pendingBefore = pendingResolvableAmfiCount(parsed);
        diagLog("mapping", "Mapping session start", {
          docId,
          fileName,
          navTrigger,
          holdings: parsed.holdings?.length ?? 0,
          pendingBefore,
        });
        logPendingMappingSummary("Before mapping", [parsed]);
        trace.appendNow(`Mapping saved CAS ${fileName}`);

        await resolveAmfiForParsedCasAfterUpload(parsed, {
          skipIsin: AMFI_RESOLUTION_SKIP_ISIN,
          trace,
          onProgress: async () => {
            diagLog("mapping", "Mapping progress — persisting partial CAS to IndexedDB", { docId });
            await updateParsedCas(docId, parsed);
          },
        });

        await updateParsedCas(docId, parsed);
        const { docs } = await refreshLibraryState({ skipLiveNav: true });
        const pending = totalPendingResolvableAmfiAcrossDocs(docs);
        logPendingMappingSummary("After mapping", docs);
        diagLog("mapping", "Mapping session end", { docId, fileName, pendingAfter: pending });
        const now = new Date().toISOString();

        setPipelineMilestones((prev) => {
          const next: CasPipelineMilestones = {
            ...prev,
            amfiCheckedAt: now,
          };
          if (pending === 0) next.amfiMappedAt = now;
          else delete next.amfiMappedAt;
          savePipelineMilestones(next);
          return next;
        });

        if (pending === 0) {
          trace.appendNow("Source mapping complete — starting portfolio NAV");
        } else {
          trace.appendNow(
            `Source mapping finished with ${pending} unresolved line(s) — starting portfolio NAV for mapped schemes`,
          );
        }
        await schedulePortfolioNavIfNeeded(docs, navTrigger);
      } catch (e) {
        diagLog("mapping", "Mapping session error", { docId, error: String(e) });
        setToast({ kind: "error", text: `Scheme code mapping failed: ${String(e)}` });
        trace.appendNow(`Error: ${String(e)}`);
      } finally {
        amfiSlotBusyRef.current = false;
        appSession.amfiSlotBusy = false;
        const nextId = amfiQueueRef.current.shift();
        if (nextId) {
          void runAmfiMappingForDoc(nextId);
        } else {
          setAmfiMappingBusy(false);
        }
      }
    },
    [refreshLibraryState, schedulePortfolioNavIfNeeded],
  );

  const runAmfiForAllPending = useCallback(async () => {
    if (amfiAllBusyRef.current) return;
    amfiAllBusyRef.current = true;
    appSession.amfiAllBusy = true;
    try {
      const index = await listCasIndex();
      for (const row of index) {
        const stored = await loadParsedCasById(row.id);
        if (!stored) continue;
        if (pendingResolvableAmfiCount(stored.parsed) > 0) {
          await runAmfiMappingForDoc(row.id, "amfi-mapped");
        }
      }
    } finally {
      amfiAllBusyRef.current = false;
      appSession.amfiAllBusy = false;
    }
  }, [runAmfiMappingForDoc]);

  const hydrate = useCallback(async () => {
    return singleFlight(appSession.hydrateFlight, async () => {
      setHydrating(true);
      diagLog("hydrate", "Hydrate start");
      try {
        const { docs, index } = await refreshLibraryState({ skipLiveNav: true });
        diagLog("hydrate", "Library loaded", {
          indexCount: index.length,
          parsedDocCount: docs.length,
        });
        logPendingMappingSummary("Hydrate library state", docs);

        const navCache = await syncPortfolioNavCacheFromDisk();
        if (navCache.skipNetwork) {
          const pendingOnCacheHit = totalPendingResolvableAmfiAcrossDocs(docs);
          if (pendingOnCacheHit > 0) {
            diagLog("hydrate", "WARNING: NAV cache restored but scheme mapping still pending", {
              pending: pendingOnCacheHit,
            });
          }
          void warmBenchmarkData().then(async () => {
            const [monthEnds, dailyNav] = await Promise.all([loadBenchmarkMonthEndNav(), loadBenchmarkDailyNav()]);
            setBenchmarkMonthEnds(monthEnds);
            setBenchmarkDailyNav(dailyNav);
          });
          diagLog("hydrate", "Hydrate end — exited early via NAV cache");
          return;
        }

        const pending = totalPendingResolvableAmfiAcrossDocs(docs);
        const allParsedOk = index.length > 0 && docs.length === index.length;
        const now = new Date().toISOString();
        let syncedMilestones: CasPipelineMilestones = {};
        setPipelineMilestones((prev) => {
          const next: CasPipelineMilestones = { ...prev };
          if (index.length > 0 && !next.savedAt) next.savedAt = index[0]?.addedAt ?? now;
          if (allParsedOk) next.parsedAt = next.parsedAt ?? now;
          if (allParsedOk && pending === 0) {
            next.amfiMappedAt = next.amfiMappedAt ?? now;
            next.amfiCheckedAt = next.amfiCheckedAt ?? now;
          } else if (allParsedOk && pending > 0) {
            next.amfiCheckedAt = next.amfiCheckedAt ?? now;
            delete next.amfiMappedAt;
          }
          syncedMilestones = next;
          savePipelineMilestones(next);
          return next;
        });

        void warmBenchmarkData().then(async () => {
          const [monthEnds, dailyNav] = await Promise.all([loadBenchmarkMonthEndNav(), loadBenchmarkDailyNav()]);
          setBenchmarkMonthEnds(monthEnds);
          setBenchmarkDailyNav(dailyNav);
        });

        const amfiRetry = shouldRetryAmfiMapping(syncedMilestones, pending);
        diagLog("hydrate", "AMFI auto-retry decision", {
          pending,
          retry: amfiRetry.retry,
          reason: amfiRetry.reason,
        });
        if (pending > 0 && amfiRetry.retry) {
          setPipelineMilestones((prev) => {
            const next = nextAmfiAutoRetryMilestones(prev);
            savePipelineMilestones(next);
            return next;
          });
          markAmfiHydrateAttemptedToday();
          void runAmfiForAllPending();
        } else {
          void schedulePortfolioNavIfNeeded(docs, "hydrate");
        }
      } catch (e) {
        diagLog("hydrate", "Hydrate error", { error: String(e) });
        setToast({ kind: "error", text: `Failed to load library: ${String(e)}` });
      } finally {
        diagLog("hydrate", "Hydrate end");
        setHydrating(false);
      }
    });
  }, [
    refreshLibraryState,
    runAmfiForAllPending,
    schedulePortfolioNavIfNeeded,
    tryRestorePortfolioNavFromCache,
    syncPortfolioNavCacheFromDisk,
  ]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const processCasFile = useCallback(
    async (file: File, password?: string) => {
      setUploadBusy(true);
      setPipelineStatus("Extracting PDF…");
      diagLog("upload", "CAS upload start", {
        fileName: file.name,
        bytes: file.size,
        hasPassword: !!password?.trim(),
      });
      try {
        const text = await extractPdfTextFromFile(file, password);
        diagLog("parse", "PDF text extracted", {
          fileName: file.name,
          charCount: text.length,
          lineCount: text.split(/\r?\n/).length,
        });
        setPipelineStatus("Parsing CAS…");
        const parsed = parseCasFromPdfText(text, file.name);
        diagLog("parse", "CAS parsed", {
          fileName: file.name,
          holdings: parsed.holdings?.length ?? 0,
          investor: parsed.investor_name ?? "",
          period: `${parsed.period_from ?? "?"} → ${parsed.period_to ?? "?"}`,
        });
        logPendingMappingSummary("After parse (pre-mapping)", [parsed]);
        setPipelineStatus("Saving…");
        const row = await saveParsedCas(file.name, parsed, text);
        diagLog("storage", "CAS saved to IndexedDB", { docId: row.id, fileName: row.name });
        const now = new Date().toISOString();
        setPipelineMilestones((prev) => {
          const next = { ...prev, savedAt: now, parsedAt: now };
          savePipelineMilestones(next);
          return next;
        });
        await refreshLibraryState({ skipLiveNav: true });

        setPipelineStatus("");
        setToast({
          kind: "success",
          text: "CAS saved — mapping scheme codes in background. Check Account for status.",
        });
        setBottomTab("account");
        void runAmfiMappingForDoc(row.id, "cas-upload");
      } catch (e) {
        diagLog("upload", "CAS upload failed", { error: String(e) });
        setPipelineStatus("");
        setToast({ kind: "error", text: String(e) });
        throw e;
      } finally {
        setUploadBusy(false);
      }
    },
    [refreshLibraryState, runAmfiMappingForDoc],
  );

  const removeCas = useCallback(
    async (id: string) => {
      await removeCasDoc(id);
      const { docs, index } = await refreshLibraryState();
      setSavedCasFiles(index);
      if (!docs.length) {
        setPipelineMilestones({});
        savePipelineMilestones({});
        setPortfolioAnalytics({});
        setPortfolioNavStatus({ kind: "none" });
      } else if (totalPendingResolvableAmfiAcrossDocs(docs) === 0) {
        await schedulePortfolioNavIfNeeded(docs, "cas-change");
      }
    },
    [refreshLibraryState, schedulePortfolioNavIfNeeded],
  );

  const activeProfile = useMemo(
    () => (activeProfileId === "family" ? null : profiles.find((p) => p.id === activeProfileId) ?? null),
    [activeProfileId, profiles],
  );

  const savedInvestors = useMemo(() => mergeUniqueInvestorsFromCasDocs(savedParsedDocs), [savedParsedDocs]);

  const profileStats = useMemo(() => {
    const byId: Record<string, { invested: number; total: number }> = {};
    for (const h of holdings) {
      if (!byId[h.profileId]) byId[h.profileId] = { invested: 0, total: 0 };
      byId[h.profileId].total += h.amount;
      byId[h.profileId].invested += h.invested;
    }
    const computed = profiles.map((p) => {
      const s = byId[p.id] || { invested: 0, total: 0 };
      const gain = s.total - s.invested;
      const fallbackXirr = s.invested > 0 ? `${((gain / s.invested) * 100).toFixed(1)}%` : "0.0%";
      return { ...p, total: s.total, invested: s.invested, xirr: p.xirr || fallbackXirr };
    });
    const familyInvested = computed.reduce((a, p) => a + p.invested, 0);
    const familyTotal = computed.reduce((a, p) => a + p.total, 0);
    const familyGain = familyTotal - familyInvested;
    const familyXirrFallback =
      familyInvested > 0 ? `${((familyGain / familyInvested) * 100).toFixed(1)}%` : "0.0%";
    return [
      {
        id: "family",
        name: "Family Portfolio",
        total: familyTotal,
        invested: familyInvested,
        xirr: familyXirr || familyXirrFallback,
      },
      ...computed,
    ];
  }, [profiles, holdings, familyXirr]);

  const activePortfolioProfile = useMemo(
    () => profileStats.find((p) => p.id === activeProfileId) ?? profileStats[0],
    [profileStats, activeProfileId],
  );

  const activeHoldings = useMemo(() => {
    if (activeProfileId === "family") return holdings;
    return holdings.filter((h) => h.profileId === activeProfileId);
  }, [activeProfileId, holdings]);

  const analyticsKey = useMemo(
    () => (activeProfileId === "family" ? "family" : `p:${(activeProfile?.name ?? "").trim().toLowerCase()}`),
    [activeProfileId, activeProfile?.name],
  );

  const perf = portfolioAnalytics[analyticsKey] ?? null;

  const hero = useMemo(() => {
    const total = activeHoldings.reduce((a, h) => a + h.current, 0);
    const invested = activeHoldings.reduce((a, h) => a + h.invested, 0);
    const gain = total - invested;
    const prior = activeHoldings.reduce((a, h) => a + (h.priorDayCurrent ?? h.current), 0);
    const dayChange = total - prior;
    const dayChangePct = prior > 0 ? (dayChange / prior) * 100 : 0;
    return {
      total,
      invested,
      gain,
      xirr: activeProfileId === "family" ? familyXirr : activePortfolioProfile?.xirr ?? "0.0%",
      dayChange,
      dayChangePct,
    };
  }, [activeHoldings, activePortfolioProfile, activeProfileId, familyXirr]);

  const insightsEligibleHoldings = useMemo(
    () => activeHoldings.filter((h) => h.amount > 0),
    [activeHoldings],
  );

  const insightsAmfiKey = useMemo(
    () =>
      [...new Set(insightsEligibleHoldings.map((h) => h.amfiCode?.trim()).filter(Boolean))].sort().join(","),
    [insightsEligibleHoldings],
  );

  const insightsHoldingsRef = useRef(insightsEligibleHoldings);
  insightsHoldingsRef.current = insightsEligibleHoldings;

  useEffect(() => {
    if (!insightsAmfiKey) {
      setUpvalyInsightsLoading(false);
      return;
    }
    let cancelled = false;
    setUpvalyInsightsLoading(true);
    void loadPortfolioInsightsForHoldings(
      insightsHoldingsRef.current.map((h) => ({ amfiCode: h.amfiCode, amount: h.amount, name: h.name })),
    )
      .then((map) => {
        if (!cancelled && Object.keys(map).length) setUpvalySchemes((prev) => ({ ...prev, ...map }));
      })
      .finally(() => {
        if (!cancelled) setUpvalyInsightsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [insightsAmfiKey]);

  const portfolioFundamentals = useMemo(
    () => buildPortfolioFundamentalsSnapshot(insightsEligibleHoldings, upvalySchemes),
    [insightsEligibleHoldings, upvalySchemes],
  );

  const sellFundsCount = useMemo(() => {
    try {
      const { sellFunds } = buildFundSellInsights(
        insightsEligibleHoldings.map((h) => ({
          id: h.id,
          name: h.name,
          category: h.category,
          subCategory: h.category,
          returnPct: h.returnPct,
          amount: h.amount,
          amfiCode: h.amfiCode,
        })),
        upvalySchemes,
        benchmarkMonthEnds.nifty500 ?? [],
      );
      return sellFunds.length;
    } catch {
      return 0;
    }
  }, [benchmarkMonthEnds, insightsEligibleHoldings, upvalySchemes]);

  const overviewSharpe = useMemo(() => {
    const s = perf?.sharpeRatio;
    return s == null || !Number.isFinite(s) ? "—" : s.toFixed(2);
  }, [perf]);

  const overviewMtd = useMemo(() => formatPct(perf?.mtdReturn), [perf]);
  const overviewYtd = useMemo(() => formatPct(perf?.ytdReturn), [perf]);

  const xRayStockRows = useMemo(
    () =>
      buildXRayHoldings(
        insightsEligibleHoldings.map((h) => ({ amfiCode: h.amfiCode, amount: h.amount, name: h.name })),
        upvalySchemes,
      ),
    [insightsEligibleHoldings, upvalySchemes],
  );

  const xRaySectorRows = useMemo(() => buildXRaySectors(xRayStockRows), [xRayStockRows]);

  const assetSlices = useMemo(() => {
    const colors: Record<string, string> = { Equity: Wealth.equity, Debt: Wealth.debt, Hybrid: Wealth.hybrid };
    const buckets = new Map<string, number>();
    for (const h of activeHoldings) {
      buckets.set(h.assetClass, (buckets.get(h.assetClass) ?? 0) + h.amount);
    }
    return [...buckets.entries()]
      .filter(([, v]) => v > 0)
      .map(([type, value]) => ({ type, value, color: colors[type] ?? Wealth.textMuted }));
  }, [activeHoldings]);

  const analysisHoldings = useMemo(
    () =>
      activeHoldings.map((h) => {
        const owner = profiles.find((p) => p.id === h.profileId)?.name ?? "Member";
        return {
          id: h.id,
          name: h.name,
          category: h.assetClass,
          subCategory: h.category,
          invested: h.invested,
          value: h.current,
          totalUnits: h.totalUnits,
          returns: h.returnPct,
          owner,
          amfiCode: h.amfiCode,
        };
      }),
    [activeHoldings, profiles],
  );

  const equityWeightPct = useMemo(() => {
    const equity = activeHoldings.filter((h) => h.assetClass === "Equity").reduce((a, h) => a + h.amount, 0);
    const total = activeHoldings.reduce((a, h) => a + h.amount, 0);
    return total > 0 ? (equity / total) * 100 : 0;
  }, [activeHoldings]);

  const refreshNav = useCallback(async () => {
    const docs = await loadAllParsedDocs();
    await schedulePortfolioNavIfNeeded(docs, "manual");
  }, [schedulePortfolioNavIfNeeded]);

  const retryAmfiMapping = useCallback(async () => {
    setAmfiMappingLog("");
    await runAmfiForAllPending();
  }, [runAmfiForAllPending]);

  const addMember = useCallback((name: string) => {
    const member = createManualMember(name);
    if (!member.name) return false;
    const manual = [...loadManualProfiles(), member];
    saveManualProfiles(manual);
    setProfiles((prev) => mergeCasAndManualProfiles(prev, [member]));
    setToast({ kind: "success", text: "Family member added" });
    return true;
  }, []);

  return {
    bottomTab,
    setBottomTab,
    homeTab,
    setHomeTab,
    profiles,
    profileStats,
    activePortfolioProfile,
    savedInvestors,
    holdings: activeHoldings,
    allHoldings: holdings,
    familyXirr,
    savedParsedDocs,
    savedCasFiles,
    activeProfileId,
    setActiveProfileId,
    hero,
    perf,
    portfolioFundamentals,
    assetSlices,
    sectorRows: xRaySectorRows,
    stockRows: xRayStockRows,
    upvalySchemes,
    analysisHoldings,
    benchmarkMonthEnds,
    benchmarkDailyNav,
    sellFundsCount,
    overviewSharpe,
    overviewMtd,
    overviewYtd,
    equityWeightPct,
    insightsEligibleHoldings,
    upvalyInsightsLoading,
    analyticsLoading,
    hydrating,
    uploadBusy,
    amfiMappingBusy,
    pipelineStatus,
    pipelineMilestones,
    amfiMappingLog,
    portfolioNavStatus,
    toast,
    setToast,
    processCasFile,
    removeCas,
    refreshNav,
    retryAmfiMapping,
    addMember,
  };
}
