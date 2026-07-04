import { brokerMcpManager } from "./mcp-manager.mjs";
import {
  completeOAuthFlow,
  getOAuthRedirectUrl,
  oauthCallbackHtml,
  startOAuthFlow,
} from "./oauth.mjs";

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function getSessionId(req, body) {
  const header = req.headers["x-mcp-session-id"];
  return (typeof header === "string" ? header : body?.sessionId) || null;
}

function getAccessToken(req, body) {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice(7);
  }
  const header = req.headers["x-mcp-access-token"];
  if (typeof header === "string") return header;
  return body?.accessToken || null;
}

function jsonResponse(res, origin, allowOrigin, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": allowOrigin === "*" ? origin : allowOrigin,
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-mcp-session-id, x-mcp-access-token",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(JSON.stringify(data));
}

export async function handleBrokerApi(req, res, url, origin, allowOrigin) {
  const path = url.pathname;

  if (req.method === "GET" && path === "/api/broker/servers") {
    jsonResponse(res, origin, allowOrigin, 200, brokerMcpManager.listServers());
    return true;
  }

  if (req.method === "GET" && path === "/api/broker/oauth/callback") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const oauthError = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");

    if (oauthError) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end(oauthCallbackHtml({ error: errorDescription || String(oauthError) }));
      return true;
    }

    try {
      const result = await completeOAuthFlow({ code: String(code), state: String(state) });
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(oauthCallbackHtml(result));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end(oauthCallbackHtml({ error: message }));
    }
    return true;
  }

  const oauthStart = path.match(/^\/api\/broker\/servers\/([^/]+)\/oauth\/start$/);
  if (req.method === "GET" && oauthStart) {
    try {
      const server = brokerMcpManager.getServer(oauthStart[1]);
      if (server.auth !== "oauth") {
        jsonResponse(res, origin, allowOrigin, 400, { error: "This broker does not use OAuth." });
        return true;
      }
      const redirectUrl = getOAuthRedirectUrl(req);
      const result = await startOAuthFlow(server, redirectUrl);
      jsonResponse(res, origin, allowOrigin, 200, result);
    } catch (e) {
      jsonResponse(res, origin, allowOrigin, 500, { error: e instanceof Error ? e.message : String(e) });
    }
    return true;
  }

  const connectMatch = path.match(/^\/api\/broker\/servers\/([^/]+)\/connect$/);
  if (req.method === "POST" && connectMatch) {
    try {
      const body = await readJsonBody(req);
      const server = brokerMcpManager.getServer(connectMatch[1]);
      const accessToken = getAccessToken(req, body);
      if (server.auth === "oauth" && !accessToken) {
        jsonResponse(res, origin, allowOrigin, 401, {
          error: "OAuth authorization required. Authorize first.",
          auth: "oauth",
        });
        return true;
      }
      const result = await brokerMcpManager.connect(
        connectMatch[1],
        getSessionId(req, body),
        accessToken,
      );
      jsonResponse(res, origin, allowOrigin, 200, result);
    } catch (e) {
      jsonResponse(res, origin, allowOrigin, 500, { error: e instanceof Error ? e.message : String(e) });
    }
    return true;
  }

  const disconnectMatch = path.match(/^\/api\/broker\/servers\/([^/]+)\/disconnect$/);
  if (req.method === "POST" && disconnectMatch) {
    try {
      const result = await brokerMcpManager.disconnect(disconnectMatch[1]);
      jsonResponse(res, origin, allowOrigin, 200, result);
    } catch (e) {
      jsonResponse(res, origin, allowOrigin, 500, { error: e instanceof Error ? e.message : String(e) });
    }
    return true;
  }

  const toolsMatch = path.match(/^\/api\/broker\/servers\/([^/]+)\/tools$/);
  if (req.method === "GET" && toolsMatch) {
    try {
      const body = {};
      await brokerMcpManager.ensureSession(
        toolsMatch[1],
        getSessionId(req, body),
        getAccessToken(req, body),
      );
      jsonResponse(res, origin, allowOrigin, 200, brokerMcpManager.getTools(toolsMatch[1]));
    } catch (e) {
      jsonResponse(res, origin, allowOrigin, 400, { error: e instanceof Error ? e.message : String(e) });
    }
    return true;
  }

  const callMatch = path.match(/^\/api\/broker\/servers\/([^/]+)\/tools\/([^/]+)\/call$/);
  if (req.method === "POST" && callMatch) {
    try {
      const body = await readJsonBody(req);
      const result = await brokerMcpManager.callTool(
        callMatch[1],
        decodeURIComponent(callMatch[2]),
        body.arguments ?? {},
        getSessionId(req, body),
        getAccessToken(req, body),
      );
      jsonResponse(res, origin, allowOrigin, 200, result);
    } catch (e) {
      jsonResponse(res, origin, allowOrigin, 500, { error: e instanceof Error ? e.message : String(e) });
    }
    return true;
  }

  return false;
}
