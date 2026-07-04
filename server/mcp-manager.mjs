import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { BROKER_SERVERS } from "./brokers.mjs";
import { createTokenAuthProvider } from "./oauth.mjs";

const globalSessions = globalThis.__wealthMcpSessions ?? new Map();
globalThis.__wealthMcpSessions = globalSessions;

export class MCPManager {
  constructor() {
    this.servers = structuredClone(BROKER_SERVERS);
    this.sessions = globalSessions;
  }

  listServers() {
    return this.servers.map((server) => ({
      ...server,
      connected: this.sessions.has(server.id),
      toolCount: this.sessions.get(server.id)?.tools?.length ?? null,
      sessionId: this.sessions.get(server.id)?.sessionId ?? null,
    }));
  }

  getServer(id) {
    const server = this.servers.find((s) => s.id === id);
    if (!server) throw new Error("Broker not found");
    return server;
  }

  async connect(id, existingSessionId, accessToken) {
    if (this.sessions.has(id)) {
      const session = this.sessions.get(id);
      return {
        status: "already_connected",
        tools: session.tools,
        sessionId: session.sessionId,
      };
    }

    const server = this.getServer(id);
    const client = new Client({ name: "wealth-web-tracker", version: "1.0.0" });

    const transportOptions = { sessionId: existingSessionId || undefined };
    if (accessToken) {
      transportOptions.authProvider = createTokenAuthProvider(accessToken);
    }

    const transport = new StreamableHTTPClientTransport(new URL(server.url), transportOptions);
    await client.connect(transport);
    const { tools } = await client.listTools();
    const sessionId = transport.sessionId ?? existingSessionId ?? null;

    this.sessions.set(id, { client, transport, tools, sessionId });
    return { status: "connected", tools, sessionId };
  }

  async ensureSession(id, sessionId, accessToken) {
    if (this.sessions.has(id)) return;
    if (sessionId || accessToken) {
      await this.connect(id, sessionId, accessToken);
      return;
    }
    throw new Error("Not connected. Connect to the broker first.");
  }

  async disconnect(id) {
    const session = this.sessions.get(id);
    if (!session) return { status: "not_connected" };

    try {
      if (session.transport.terminateSession) {
        await session.transport.terminateSession();
      }
      await session.client.close();
    } catch {
      // best-effort
    }
    this.sessions.delete(id);
    return { status: "disconnected" };
  }

  getTools(id) {
    const session = this.sessions.get(id);
    if (!session) throw new Error("Not connected. Connect to the broker first.");
    return session.tools;
  }

  async callTool(id, toolName, args = {}, sessionId, accessToken) {
    await this.ensureSession(id, sessionId, accessToken);
    const session = this.sessions.get(id);
    return session.client.callTool({ name: toolName, arguments: args });
  }
}

export const brokerMcpManager = new MCPManager();
