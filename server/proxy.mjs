/**
 * Production server: static SPA + CORS proxy for Nifty TRI + AMFI NAV.
 * Listens on PORT (default 8080) and 0.0.0.0 for cloud hosts.
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { URL } from "node:url";
import { corsHeaders, fetchAmfiNavHistory, fetchAmfiPortalNav, fetchNiftyTri } from "./upstream.mjs";
import {
  chatWithMistral,
  mistralChatTurn,
  mistralMemoryExtract,
  streamChatWithMistral,
  streamMistralChat,
} from "./mistral.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadEnvFile(path.resolve(__dirname, "../.env.local"));
loadEnvFile(path.resolve(__dirname, "../.env"));
const PORT = Number(process.env.PORT ?? process.env.CORS_PROXY_PORT ?? 8080);
const HOST = process.env.HOST ?? "0.0.0.0";
const ALLOW_ORIGIN = process.env.CORS_ALLOW_ORIGIN ?? "*";

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function forwardJson(res, origin, upstreamRes) {
  const text = await upstreamRes.text();
  res.writeHead(upstreamRes.status, {
    ...corsHeaders(origin, ALLOW_ORIGIN),
    "Content-Type": upstreamRes.headers.get("content-type") ?? "application/json",
  });
  res.end(text);
}

function serveStatic(res, origin, filePath, contentType) {
  if (!existsSync(filePath)) {
    res.writeHead(404, { ...corsHeaders(origin, ALLOW_ORIGIN), "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }
  res.writeHead(200, { ...corsHeaders(origin, ALLOW_ORIGIN), "Content-Type": contentType });
  res.end(readFileSync(filePath));
}

const distDir = path.resolve(__dirname, "../dist");

const server = createServer(async (req, res) => {
  const origin = req.headers.origin ?? "*";
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(origin, ALLOW_ORIGIN));
    res.end();
    return;
  }

  try {
    if (req.method === "POST" && url.pathname === "/api/nifty/tri") {
      const body = await readBody(req);
      const upstream = await fetchNiftyTri(body);
      await forwardJson(res, origin, upstream);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/amfi/nav-history") {
      const upstream = await fetchAmfiNavHistory(url.searchParams);
      await forwardJson(res, origin, upstream);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/amfi/portal-nav") {
      const frmdt = url.searchParams.get("frmdt") ?? "";
      const upstream = await fetchAmfiPortalNav(frmdt);
      const text = await upstream.text();
      res.writeHead(upstream.status, {
        ...corsHeaders(origin, ALLOW_ORIGIN),
        "Content-Type": upstream.headers.get("content-type") ?? "text/plain",
      });
      res.end(text);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/portfolio/chat") {
      const body = await readBody(req);
      const payload = JSON.parse(body.toString("utf8") || "{}");
      const headerKey = req.headers["x-mistral-api-key"];
      const fromHeader =
        (typeof headerKey === "string" ? headerKey : Array.isArray(headerKey) ? headerKey[0] : "")?.trim() || "";
      const fromBody = typeof payload.apiKey === "string" ? payload.apiKey.trim() : "";
      const apiKey = fromBody || fromHeader || undefined;
      const chatInput = {
        messages: Array.isArray(payload.messages) ? payload.messages : [],
        context: typeof payload.context === "string" ? payload.context : "",
        apiKey,
      };
      const useTools = payload.tools === true;
      const memoryContext = typeof payload.memoryContext === "string" ? payload.memoryContext : "";

      if (payload.memoryExtract === true) {
        const result = await mistralMemoryExtract({
          systemPrompt: typeof payload.systemPrompt === "string" ? payload.systemPrompt : "",
          userContent: typeof payload.userContent === "string" ? payload.userContent : "",
          apiKey,
        });
        res.writeHead(200, { ...corsHeaders(origin, ALLOW_ORIGIN), "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
        return;
      }

      if (useTools && payload.stream !== true) {
        const result = await mistralChatTurn({ ...chatInput, tools: true, memoryContext });
        res.writeHead(200, { ...corsHeaders(origin, ALLOW_ORIGIN), "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
        return;
      }

      if (payload.stream === true && useTools) {
        res.writeHead(200, {
          ...corsHeaders(origin, ALLOW_ORIGIN),
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        });
        try {
          const result = await streamMistralChat({
            messages: chatInput.messages,
            apiKey,
            memoryContext,
            onChunk: (text) => {
              res.write(`data: ${JSON.stringify({ text })}\n\n`);
            },
          });
          res.write(`data: ${JSON.stringify({ done: true, model: result.model })}\n\n`);
          res.end();
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
          res.end();
        }
        return;
      }

      if (payload.stream === true) {
        res.writeHead(200, {
          ...corsHeaders(origin, ALLOW_ORIGIN),
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        });
        try {
          const result = await streamChatWithMistral({
            ...chatInput,
            onChunk: (text) => {
              res.write(`data: ${JSON.stringify({ text })}\n\n`);
            },
          });
          res.write(`data: ${JSON.stringify({ done: true, model: result.model })}\n\n`);
          res.end();
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
          res.end();
        }
        return;
      }

      const result = await chatWithMistral(chatInput);
      res.writeHead(200, { ...corsHeaders(origin, ALLOW_ORIGIN), "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return;
    }

    if (url.pathname === "/health") {
      res.writeHead(200, { ...corsHeaders(origin, ALLOW_ORIGIN), "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "wealth-web" }));
      return;
    }

    if (req.method === "GET") {
      const rel = url.pathname === "/" ? "/index.html" : url.pathname;
      const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, "");
      const filePath = path.join(distDir, safe);
      if (filePath.startsWith(distDir) && existsSync(filePath) && !filePath.endsWith(".html")) {
        const ext = path.extname(filePath);
        const types = {
          ".js": "application/javascript",
          ".css": "text/css",
          ".json": "application/json",
          ".svg": "image/svg+xml",
          ".png": "image/png",
          ".csv": "text/csv",
          ".woff2": "font/woff2",
        };
        serveStatic(res, origin, filePath, types[ext] ?? "application/octet-stream");
        return;
      }
      const indexPath = path.join(distDir, "index.html");
      if (existsSync(indexPath)) {
        serveStatic(res, origin, indexPath, "text/html");
        return;
      }
    }

    res.writeHead(404, { ...corsHeaders(origin, ALLOW_ORIGIN), "Content-Type": "text/plain" });
    res.end("Not found");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status =
      message.includes("is required") || message.includes("not set") || message.includes("API key")
        ? 500
        : 502;
    res.writeHead(status, { ...corsHeaders(origin, ALLOW_ORIGIN), "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Wealth web listening on http://${HOST}:${PORT}`);
});
