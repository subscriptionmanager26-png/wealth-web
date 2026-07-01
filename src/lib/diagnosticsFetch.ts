/**
 * Global fetch instrumentation for mapping / NAV network analysis (web only).
 */
import { diagLog } from "./diagnosticsLog";

const LOGGED_URL_PATTERNS = [
  /\/api\/amfi\//i,
  /\/api\/nifty\//i,
  /api\.mfapi\.in/i,
  /unique_schemes\.csv/i,
];

let installed = false;
let reqSeq = 0;

function shouldLogUrl(url: string): boolean {
  return LOGGED_URL_PATTERNS.some((re) => re.test(url));
}

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

async function summarizeResponse(url: string, res: Response): Promise<string> {
  try {
    if (url.includes("/api/amfi/nav-history")) {
      const body = (await res.clone().json()) as { data?: { nav_groups?: unknown[] } };
      const groups = body?.data?.nav_groups?.length ?? 0;
      let points = 0;
      for (const g of body?.data?.nav_groups ?? []) {
        const recs = (g as { historical_records?: unknown[] })?.historical_records;
        points += recs?.length ?? 0;
      }
      return `nav_groups=${groups} nav_points=${points}`;
    }
    if (url.includes("/api/amfi/portal-nav")) {
      const text = await res.clone().text();
      const lineCount = text ? text.split(/\r?\n/).filter(Boolean).length : 0;
      return `bytes=${text.length} lines=${lineCount}`;
    }
    if (url.includes("api.mfapi.in")) {
      const body = (await res.clone().json()) as { status?: string; data?: unknown[] };
      return `mfapi_status=${body?.status ?? "?"} data_rows=${body?.data?.length ?? 0}`;
    }
    if (url.includes("unique_schemes.csv")) {
      const text = await res.clone().text();
      return `csv_bytes=${text.length} csv_lines=${text.split(/\r?\n/).length}`;
    }
    if (url.includes("/api/nifty/")) {
      const text = await res.clone().text();
      return `bytes=${text.length}`;
    }
  } catch (e) {
    return `body_read_error=${String(e)}`;
  }
  return "";
}

export function installGlobalFetchDiagnostics(): void {
  if (installed || typeof window === "undefined" || typeof window.fetch !== "function") return;
  installed = true;

  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = resolveUrl(input);
    if (!shouldLogUrl(url)) {
      return nativeFetch(input, init);
    }

    const id = ++reqSeq;
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const t0 = performance.now();
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const aborted = signal?.aborted ?? false;

    diagLog("network", `FETCH START #${id} ${method} ${url}`, {
      abortedBeforeSend: aborted,
      hasSignal: !!signal,
    });

    if (signal) {
      signal.addEventListener("abort", () => {
        diagLog("network", `FETCH ABORT signal #${id} ${url}`, {
          elapsedMs: Math.round(performance.now() - t0),
        });
      });
    }

    try {
      const res = await nativeFetch(input, init);
      const ms = Math.round(performance.now() - t0);
      const summary = await summarizeResponse(url, res);
      if (!res.ok) {
        let errBody = "";
        try {
          errBody = (await res.clone().text()).slice(0, 300);
        } catch {
          /* ignore */
        }
        diagLog("network", `FETCH FAIL #${id} HTTP ${res.status} ${method} ${url} (${ms}ms)`, {
          summary,
          errBody,
        });
      } else {
        diagLog("network", `FETCH OK #${id} HTTP ${res.status} ${method} ${url} (${ms}ms) ${summary}`, {
          ok: true,
        });
      }
      return res;
    } catch (e) {
      const ms = Math.round(performance.now() - t0);
      const name = e instanceof Error ? e.name : "Error";
      const msg = e instanceof Error ? e.message : String(e);
      diagLog("network", `FETCH ERROR #${id} ${method} ${url} (${ms}ms) ${name}: ${msg}`, {
        stack: e instanceof Error ? e.stack?.split("\n").slice(0, 3).join(" | ") : undefined,
      });
      throw e;
    }
  };

  diagLog("session", "Global fetch diagnostics installed", {
    patterns: LOGGED_URL_PATTERNS.map((re) => re.source),
  });
}
