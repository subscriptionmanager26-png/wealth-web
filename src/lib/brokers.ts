export type BrokerId = "kite" | "indmoney" | "upstox" | "dhan" | "groww";

export type BrokerAuthType = "login" | "oauth";

export type BrokerDefinition = {
  id: BrokerId;
  name: string;
  auth: BrokerAuthType;
  supported: boolean;
  docs: string;
};

export const BROKERS: BrokerDefinition[] = [
  {
    id: "kite",
    name: "Zerodha",
    auth: "login",
    supported: true,
    docs: "https://zerodha.com/z-connect/featured/connect-your-zerodha-account-to-ai-assistants-with-kite-mcp",
  },
  {
    id: "indmoney",
    name: "INDmoney",
    auth: "oauth",
    supported: true,
    docs: "https://www.indmoney.com/mcp",
  },
  {
    id: "upstox",
    name: "Upstox",
    auth: "oauth",
    supported: false,
    docs: "https://upstox.com/developer/api-documentation/mcp-integration/",
  },
  {
    id: "dhan",
    name: "Dhan",
    auth: "login",
    supported: false,
    docs: "https://docs.dhanhq.co/mcp/",
  },
  {
    id: "groww",
    name: "Groww",
    auth: "oauth",
    supported: false,
    docs: "https://groww.in/updates/groww-mcp",
  },
];

export const BROKER_LABELS: Record<BrokerId, string> = Object.fromEntries(
  BROKERS.map((b) => [b.id, b.name]),
) as Record<BrokerId, string>;

export function getBroker(id: BrokerId): BrokerDefinition {
  const b = BROKERS.find((x) => x.id === id);
  if (!b) throw new Error(`Unknown broker: ${id}`);
  return b;
}
