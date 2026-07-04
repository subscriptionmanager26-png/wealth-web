import { URL } from "node:url";
import { handleBrokerApi } from "../../server/broker-api.mjs";

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  const host = req.headers.host ?? "localhost";
  const protocol = req.headers["x-forwarded-proto"] ?? "https";
  const requestUrl = req.url?.startsWith("http") ? req.url : `${protocol}://${host}${req.url ?? "/"}`;
  const url = new URL(requestUrl);
  const origin = req.headers.origin ?? "*";

  const handled = await handleBrokerApi(req, res, url, origin, "*");
  if (!handled) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }
}
