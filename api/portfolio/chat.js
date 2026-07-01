import {
  chatWithMistral,
  mistralChatTurn,
  streamChatWithMistral,
  streamMistralChat,
} from "../../server/mistral.mjs";
import { corsHeaders } from "../../server/upstream.mjs";

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function parsePayload(raw) {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

function resolveApiKey(req, payload) {
  const headerKey = req.headers["x-mistral-api-key"];
  const fromHeader =
    (typeof headerKey === "string" ? headerKey : Array.isArray(headerKey) ? headerKey[0] : "")?.trim() || "";
  const fromBody = typeof payload.apiKey === "string" ? payload.apiKey.trim() : "";
  return fromBody || fromHeader || undefined;
}

function errorStatus(message) {
  return message.includes("is required") || message.includes("not set") || message.includes("API key") ? 500 : 502;
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
    const payload = parsePayload(body);
    const apiKey = resolveApiKey(req, payload);
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const useTools = payload.tools === true;
    const context = typeof payload.context === "string" ? payload.context : "";

    if (useTools && payload.stream !== true) {
      const result = await mistralChatTurn({ messages, apiKey, tools: true });
      res.writeHead(200, { ...corsHeaders(origin), "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return;
    }

    if (payload.stream === true && useTools) {
      res.writeHead(200, {
        ...corsHeaders(origin),
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      try {
        const result = await streamMistralChat({
          messages,
          apiKey,
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
        ...corsHeaders(origin),
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      try {
        const result = await streamChatWithMistral({
          messages,
          context,
          apiKey,
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

    const result = await chatWithMistral({ messages, context, apiKey });
    res.writeHead(200, { ...corsHeaders(origin), "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.writeHead(errorStatus(message), { ...corsHeaders(origin), "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
};
