export const BROKER_SERVERS = [
  {
    id: "kite",
    name: "Zerodha (Kite)",
    type: "http",
    url: "https://mcp.kite.trade/mcp",
    auth: "login",
    supported: true,
    docs: "https://zerodha.com/z-connect/featured/connect-your-zerodha-account-to-ai-assistants-with-kite-mcp",
  },
  {
    id: "indmoney",
    name: "INDmoney",
    type: "http",
    url: "https://mcp.indmoney.com/mcp",
    auth: "oauth",
    supported: true,
    docs: "https://www.indmoney.com/mcp",
  },
  {
    id: "upstox",
    name: "Upstox",
    type: "http",
    url: "https://mcp.upstox.com/mcp",
    auth: "oauth",
    supported: false,
    docs: "https://upstox.com/developer/api-documentation/mcp-integration/",
  },
  {
    id: "dhan",
    name: "Dhan",
    type: "http",
    url: "https://mcp.dhan.co/mcp",
    auth: "login",
    supported: false,
    docs: "https://docs.dhanhq.co/mcp/",
  },
  {
    id: "groww",
    name: "Groww",
    type: "http",
    url: "https://mcp.groww.in/mcp",
    auth: "oauth",
    supported: false,
    docs: "https://groww.in/updates/groww-mcp",
  },
];

export const PROTECTED_SERVER_IDS = new Set(BROKER_SERVERS.map((s) => s.id));

export function getBroker(id) {
  return BROKER_SERVERS.find((s) => s.id === id);
}
