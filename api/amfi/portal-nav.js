import { corsHeaders, fetchAmfiPortalNav } from "../../server/upstream.mjs";

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
    const frmdt = new URLSearchParams(qs).get("frmdt") ?? "";
    const upstream = await fetchAmfiPortalNav(frmdt);
    const text = await upstream.text();
    res.writeHead(upstream.status, {
      ...corsHeaders(origin),
      "Content-Type": upstream.headers.get("content-type") ?? "text/plain",
    });
    res.end(text);
  } catch (e) {
    res.writeHead(502, { ...corsHeaders(origin), "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(e) }));
  }
}
