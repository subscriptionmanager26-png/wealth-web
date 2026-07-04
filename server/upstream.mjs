/** Shared upstream fetchers for Nifty TRI + AMFI NAV (dev proxy + serverless). */

/** Live endpoint (not the legacy Backpage.aspx path — that returns homepage HTML to bots). */
export const NIFTY_TRI = "https://www.niftyindices.com/BackPage/getTotalReturnIndexString";
export const NIFTY_HISTORICAL_PAGE = "https://www.niftyindices.com/reports/historical-data";
export const AMFI_NAV = "https://www.amfiindia.com/api/nav-history";
export const AMFI_PORTAL_NAV = "https://portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const proxyStats = { nifty: 0, amfi: 0, portal: 0, windowStart: Date.now() };

/** @type {string | null} */
let niftySessionCookie = null;
let niftySessionAt = 0;
const NIFTY_SESSION_TTL_MS = 10 * 60 * 1000;

function logProxyStats(kind) {
  proxyStats[kind] += 1;
  const elapsed = Date.now() - proxyStats.windowStart;
  if (elapsed >= 5000) {
    const niftyPerSec = (proxyStats.nifty / elapsed) * 1000;
    const amfiPerSec = (proxyStats.amfi / elapsed) * 1000;
    const portalPerSec = (proxyStats.portal / elapsed) * 1000;
    console.log(
      `[proxy-stats] last ${(elapsed / 1000).toFixed(1)}s — Nifty: ${proxyStats.nifty} (${niftyPerSec.toFixed(1)}/s), AMFI: ${proxyStats.amfi} (${amfiPerSec.toFixed(1)}/s), Portal: ${proxyStats.portal} (${portalPerSec.toFixed(1)}/s)`,
    );
    proxyStats.nifty = 0;
    proxyStats.amfi = 0;
    proxyStats.portal = 0;
    proxyStats.windowStart = Date.now();
  }
}

export function getProxyStats() {
  return { ...proxyStats };
}

export function corsHeaders(origin, allowOrigin = process.env.CORS_ALLOW_ORIGIN ?? "*") {
  return {
    "Access-Control-Allow-Origin": allowOrigin === "*" ? origin || "*" : allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    Vary: "Origin",
  };
}

function normalizeNiftyTriBody(body) {
  const raw = typeof body === "string" ? body : body.toString("utf8");
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.cinfo === "string") return raw;
    if (parsed && typeof parsed.indexName === "string") {
      return JSON.stringify({ cinfo: raw });
    }
  } catch {
    /* not JSON — treat as pre-serialized cinfo string */
  }
  return JSON.stringify({ cinfo: raw });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cookieHeaderFromResponse(res) {
  const getSetCookie = res.headers.getSetCookie?.bind(res.headers);
  const parts = typeof getSetCookie === "function" ? getSetCookie() : [];
  if (parts.length) {
    return parts.map((c) => c.split(";")[0]?.trim()).filter(Boolean).join("; ");
  }
  const single = res.headers.get("set-cookie");
  if (!single) return null;
  return single
    .split(/,(?=[^;]+?=)/)
    .map((c) => c.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

async function warmNiftySession(force = false) {
  if (!force && niftySessionCookie && Date.now() - niftySessionAt < NIFTY_SESSION_TTL_MS) {
    return niftySessionCookie;
  }
  try {
    const res = await fetch(NIFTY_HISTORICAL_PAGE, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": BROWSER_UA,
      },
      signal: AbortSignal.timeout(30000),
      redirect: "follow",
    });
    const cookie = cookieHeaderFromResponse(res);
    if (cookie) {
      niftySessionCookie = cookie;
      niftySessionAt = Date.now();
      return cookie;
    }
  } catch {
    /* warm-up is best-effort */
  }
  return niftySessionCookie;
}

function niftyHeaders(cookie) {
  const headers = {
    Accept: "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "en-US,en;q=0.9,hi;q=0.8",
    "Content-Type": "application/json; charset=UTF-8",
    Origin: "https://www.niftyindices.com",
    Referer: NIFTY_HISTORICAL_PAGE,
    "User-Agent": BROWSER_UA,
    "X-Requested-With": "XMLHttpRequest",
  };
  if (cookie) headers.Cookie = cookie;
  return headers;
}

/** True when Akamai/WAF returned an HTML page instead of TRI JSON. */
export function isNiftyHtmlBlockResponse(text) {
  const t = String(text ?? "").trim();
  return t.startsWith("<") || t.includes("<!DOCTYPE");
}

/**
 * POST to Nifty TRI with browser-like headers, session warm-up, and retries.
 * Nifty intermittently returns 403 / times out for datacenter IPs (e.g. GitHub Actions).
 */
export async function fetchNiftyTri(body, options = {}) {
  logProxyStats("nifty");
  const postBody = normalizeNiftyTriBody(body);
  const maxAttempts = options.retries ?? 4;

  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const cookie = await warmNiftySession(attempt > 1);
    try {
      const res = await fetch(NIFTY_TRI, {
        method: "POST",
        headers: niftyHeaders(cookie),
        body: postBody,
        signal: AbortSignal.timeout(options.timeoutMs ?? 90000),
      });

      if (res.ok) return res;

      const retryable = res.status === 403 || res.status === 429 || res.status >= 500;
      if (!retryable || attempt === maxAttempts) return res;

      niftySessionCookie = null;
      niftySessionAt = 0;
      const waitMs = Math.min(15_000, 1500 * 2 ** (attempt - 1));
      console.warn(`[nifty] attempt ${attempt}/${maxAttempts} got ${res.status}, retrying in ${waitMs}ms`);
      await sleep(waitMs);
    } catch (e) {
      lastError = e;
      niftySessionCookie = null;
      niftySessionAt = 0;
      if (attempt === maxAttempts) throw e;
      const waitMs = Math.min(15_000, 1500 * 2 ** (attempt - 1));
      console.warn(
        `[nifty] attempt ${attempt}/${maxAttempts} error: ${e instanceof Error ? e.message : e}, retrying in ${waitMs}ms`,
      );
      await sleep(waitMs);
    }
  }

  throw lastError ?? new Error("Nifty TRI fetch failed");
}

export async function fetchAmfiNavHistory(searchParams) {
  logProxyStats("amfi");
  const qs = typeof searchParams === "string" ? searchParams : searchParams.toString();
  return fetch(`${AMFI_NAV}?${qs}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": BROWSER_UA,
    },
    signal: AbortSignal.timeout(30000),
  });
}

export async function fetchAmfiPortalNav(frmdt) {
  logProxyStats("portal");
  return fetch(`${AMFI_PORTAL_NAV}?frmdt=${encodeURIComponent(frmdt)}`, {
    headers: {
      Accept: "text/plain,*/*",
      "User-Agent": BROWSER_UA,
    },
    signal: AbortSignal.timeout(30000),
  });
}
