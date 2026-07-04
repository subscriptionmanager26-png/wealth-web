import type { BrokerId } from "./brokers";

const sessionKey = (id: BrokerId) => `mcp-session:${id}`;
const oauthKey = (id: BrokerId) => `mcp-oauth:${id}`;

export function loadSessionId(id: BrokerId): string | null {
  return sessionStorage.getItem(sessionKey(id));
}

export function saveSessionId(id: BrokerId, sessionId: string | null): void {
  if (sessionId) sessionStorage.setItem(sessionKey(id), sessionId);
  else sessionStorage.removeItem(sessionKey(id));
}

export function loadOAuthToken(id: BrokerId): string | null {
  try {
    const raw = localStorage.getItem(oauthKey(id));
    if (!raw) return null;
    const tokens = JSON.parse(raw) as { access_token?: string };
    return tokens.access_token ?? null;
  } catch {
    return null;
  }
}

export function hasOAuthToken(id: BrokerId): boolean {
  return Boolean(loadOAuthToken(id));
}

export function clearBrokerAuth(id: BrokerId): void {
  sessionStorage.removeItem(sessionKey(id));
  localStorage.removeItem(oauthKey(id));
}

export function listenOAuthComplete(onDone: (payload: { serverId?: string; error?: string }) => void): () => void {
  const handler = (event: MessageEvent) => {
    if (event.data?.type === "mcp-oauth-complete") {
      onDone(event.data);
    }
  };
  window.addEventListener("message", handler);
  return () => window.removeEventListener("message", handler);
}
