/** Shared upstream fetchers for Nifty TRI + AMFI NAV (dev proxy + serverless). */

export const NIFTY_TRI = "https://www.niftyindices.com/Backpage.aspx/getTotalReturnIndexString";
export const AMFI_NAV = "https://www.amfiindia.com/api/nav-history";
export const AMFI_PORTAL_NAV = "https://portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx";

const proxyStats = { nifty: 0, amfi: 0, portal: 0, windowStart: Date.now() };

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

export async function fetchNiftyTri(body) {
  logProxyStats("nifty");
  return fetch(NIFTY_TRI, {
    method: "POST",
    headers: {
      Accept: "application/json, text/javascript, */*; q=0.01",
      "Content-Type": "application/json; charset=UTF-8",
      Origin: "https://www.niftyindices.com",
      Referer: "https://www.niftyindices.com/reports/historical-data",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: typeof body === "string" ? body : body.toString("utf8"),
    signal: AbortSignal.timeout(60000),
  });
}

export async function fetchAmfiNavHistory(searchParams) {
  logProxyStats("amfi");
  const qs = typeof searchParams === "string" ? searchParams : searchParams.toString();
  return fetch(`${AMFI_NAV}?${qs}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; portfolio-web/1.0)",
    },
    signal: AbortSignal.timeout(30000),
  });
}

export async function fetchAmfiPortalNav(frmdt) {
  logProxyStats("portal");
  return fetch(`${AMFI_PORTAL_NAV}?frmdt=${encodeURIComponent(frmdt)}`, {
    headers: {
      Accept: "text/plain,*/*",
      "User-Agent": "Mozilla/5.0 (compatible; portfolio-web/1.0)",
    },
    signal: AbortSignal.timeout(30000),
  });
}
