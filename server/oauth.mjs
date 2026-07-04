import { randomUUID } from "node:crypto";
import {
  discoverOAuthServerInfo,
  registerClient,
  startAuthorization,
  exchangeAuthorization,
} from "@modelcontextprotocol/sdk/client/auth.js";

const pendingOAuth = globalThis.__wealthOAuthPending ?? new Map();
globalThis.__wealthOAuthPending = pendingOAuth;

export function getOAuthRedirectUrl(req) {
  if (process.env.OAUTH_REDIRECT_URL) {
    return process.env.OAUTH_REDIRECT_URL;
  }
  const host = req.headers.host || "localhost:3457";
  const protocol = req.headers["x-forwarded-proto"] || "http";
  return `${protocol}://${host}/api/broker/oauth/callback`;
}

export async function startOAuthFlow(server, redirectUrl) {
  const { authorizationServerUrl, authorizationServerMetadata, resourceMetadata } =
    await discoverOAuthServerInfo(server.url);

  const clientMetadata = {
    client_name: "Wealth Web Tracker",
    redirect_uris: [redirectUrl],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };

  const clientInformation = await registerClient(authorizationServerUrl, {
    metadata: authorizationServerMetadata,
    clientMetadata,
    scope: resourceMetadata?.scopes_supported?.join(" "),
  });

  const state = randomUUID();
  const { authorizationUrl, codeVerifier } = await startAuthorization(authorizationServerUrl, {
    metadata: authorizationServerMetadata,
    clientInformation,
    redirectUrl,
    state,
    scope: resourceMetadata?.scopes_supported?.join(" "),
    resource: resourceMetadata?.resource ? new URL(resourceMetadata.resource) : new URL(server.url),
  });

  pendingOAuth.set(state, {
    serverId: server.id,
    codeVerifier,
    clientInformation,
    authorizationServerUrl,
    metadata: authorizationServerMetadata,
    redirectUrl,
    resource: resourceMetadata?.resource ? new URL(resourceMetadata.resource) : new URL(server.url),
    createdAt: Date.now(),
  });

  for (const [key, value] of pendingOAuth.entries()) {
    if (Date.now() - value.createdAt > 15 * 60 * 1000) {
      pendingOAuth.delete(key);
    }
  }

  return { authUrl: authorizationUrl.toString(), state };
}

export async function completeOAuthFlow({ code, state }) {
  const pending = pendingOAuth.get(state);
  if (!pending) {
    throw new Error("OAuth session expired or invalid state. Please try again.");
  }

  const tokens = await exchangeAuthorization(pending.authorizationServerUrl, {
    metadata: pending.metadata,
    clientInformation: pending.clientInformation,
    authorizationCode: code,
    codeVerifier: pending.codeVerifier,
    redirectUri: pending.redirectUrl,
    resource: pending.resource,
  });

  pendingOAuth.delete(state);
  return { serverId: pending.serverId, tokens };
}

export function createTokenAuthProvider(accessToken) {
  return {
    redirectUrl: undefined,
    clientMetadata: { client_name: "Wealth Web Tracker", redirect_uris: [] },
    clientInformation: () => undefined,
    tokens: () => ({ access_token: accessToken, token_type: "Bearer" }),
    saveTokens: () => {},
    redirectToAuthorization: () => {},
    codeVerifier: () => "",
    saveCodeVerifier: () => {},
  };
}

export function oauthCallbackHtml({ serverId, tokens, error }) {
  const payload = JSON.stringify({ serverId, tokens, error }).replace(/</g, "\\u003c");
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Wealth Web — Broker authorization</title>
    <style>
      body { font-family: system-ui, sans-serif; background: #f8f9fb; color: #1a1d26; display: grid; place-items: center; min-height: 100vh; margin: 0; }
      .card { background: #fff; border: 1px solid #e2e6ef; border-radius: 12px; padding: 2rem; max-width: 420px; text-align: center; box-shadow: 0 4px 24px rgba(0,0,0,.06); }
      .ok { color: #16a34a; }
      .err { color: #dc2626; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1 class="${error ? "err" : "ok"}">${error ? "Authorization failed" : "Authorized!"}</h1>
      <p>${error ? error : "You can close this tab and return to Wealth Web Tracker."}</p>
    </div>
    <script>
      const payload = ${payload};
      if (payload.tokens) {
        localStorage.setItem('mcp-oauth:' + payload.serverId, JSON.stringify(payload.tokens));
      }
      if (window.opener) {
        window.opener.postMessage({ type: 'mcp-oauth-complete', ...payload }, '*');
        setTimeout(() => window.close(), 1200);
      } else {
        window.location.href = '/?oauth=' + (payload.error ? 'error' : 'success') + '&broker=' + encodeURIComponent(payload.serverId || '');
      }
    </script>
  </body>
</html>`;
}
