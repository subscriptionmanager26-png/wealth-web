import type { McpToolResult } from "./brokerHoldings/types";
import type { BrokerId } from "./brokers";
import { loadOAuthToken, loadSessionId } from "./brokerAuth";

const API = "/api/broker";

export type BrokerServerInfo = {
  id: BrokerId;
  name: string;
  auth: "login" | "oauth";
  supported: boolean;
  connected: boolean;
  sessionId: string | null;
  toolCount: number | null;
};

async function brokerFetch<T>(path: string, options: RequestInit = {}, brokerId?: BrokerId): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (brokerId) {
    const sessionId = loadSessionId(brokerId);
    if (sessionId) headers["x-mcp-session-id"] = sessionId;
    const token = loadOAuthToken(brokerId);
    if (token) headers["x-mcp-access-token"] = token;
  }

  const res = await fetch(`${API}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || res.statusText);
  }
  return data as T;
}

export async function listBrokerServers(): Promise<BrokerServerInfo[]> {
  return brokerFetch("/servers");
}

export async function startBrokerOAuth(brokerId: BrokerId): Promise<{ authUrl: string; state: string }> {
  return brokerFetch(`/servers/${brokerId}/oauth/start`);
}

export async function connectBroker(
  brokerId: BrokerId,
): Promise<{ status: string; tools: { name: string; description?: string }[]; sessionId: string | null }> {
  const sessionId = loadSessionId(brokerId);
  const accessToken = loadOAuthToken(brokerId);
  return brokerFetch(
    `/servers/${brokerId}/connect`,
    {
      method: "POST",
      body: JSON.stringify({ sessionId, accessToken }),
    },
    brokerId,
  );
}

export async function disconnectBroker(brokerId: BrokerId): Promise<{ status: string }> {
  return brokerFetch(`/servers/${brokerId}/disconnect`, { method: "POST" }, brokerId);
}

export async function callBrokerTool(
  brokerId: BrokerId,
  toolName: string,
  args: Record<string, unknown> = {},
): Promise<McpToolResult> {
  return brokerFetch(
    `/servers/${brokerId}/tools/${encodeURIComponent(toolName)}/call`,
    { method: "POST", body: JSON.stringify({ arguments: args }) },
    brokerId,
  );
}
