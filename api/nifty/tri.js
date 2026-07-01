import { corsHeaders, fetchNiftyTri } from "../../server/upstream.mjs";

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  const origin = req.headers.origin ?? "*";

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(origin));
    res.end();
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, { ...corsHeaders(origin), "Content-Type": "text/plain" });
    res.end("Method not allowed");
    return;
  }

  try {
    const body = await readRawBody(req);
    const upstream = await fetchNiftyTri(body);
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

export const config = {
  api: {
    bodyParser: false,
  },
};
