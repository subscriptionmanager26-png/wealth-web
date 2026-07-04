import { URL } from "node:url";
import { handleBrokerApi } from "../server/broker-api.mjs";

export const config = {
  maxDuration: 60,
};

function buildRequestUrl(req) {
  const host = req.headers.host ?? "localhost";
  const protocol = req.headers["x-forwarded-proto"] ?? "https";
  const rawPath = req.query?.__path;
  const suffix = Array.isArray(rawPath) ? rawPath.join("/") : rawPath || "";
  const pathname = suffix ? `/api/broker/${suffix}` : "/api/broker";

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query ?? {})) {
    if (key === "__path") continue;
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, String(v));
    } else if (value != null) {
      params.append(key, String(value));
    }
  }
  const search = params.toString();
  return new URL(`${pathname}${search ? `?${search}` : ""}`, `${protocol}://${host}`);
}

export default async function handler(req, res) {
  const url = buildRequestUrl(req);
  const origin = req.headers.origin ?? "*";

  const handled = await handleBrokerApi(req, res, url, origin, "*");
  if (!handled) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found", path: url.pathname }));
  }
}
