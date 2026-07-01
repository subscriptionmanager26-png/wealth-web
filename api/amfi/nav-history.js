import { corsHeaders, fetchAmfiNavHistory } from "../../server/upstream.mjs";

export default async function handler(req, res) {
  const origin = req.headers.origin ?? "*";

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(origin));
    res.end();
    return;
  }

  if (req.method !== "GET") {
    res.writeHead(405, { ...corsHeaders(origin), "Content-Type": "text/plain" });
    res.end("Method not allowed");
    return;
  }

  try {
    const qs = req.url?.includes("?") ? req.url.slice(req.url.indexOf("?") + 1) : "";
    const upstream = await fetchAmfiNavHistory(qs);
    const text = await upstream.text();
    res.writeHead(upstream.status, {
      ...corsHeaders(origin),
      "Content-Type": upstream.headers.get("content-type") ?? "application/json",
    });
    res.end(text);
  } catch (e) {
    res.writeHead(502, { ...corsHeaders(origin), "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(e) }));
  }
}
