import { useCallback, useEffect, useState } from "react";

import { INDMONEY_ASSET_TYPES } from "../lib/brokerHoldings/indmoney";
import { extractLoginUrl, mergeParsedHoldings, parseBrokerHoldings } from "../lib/brokerHoldings/parse";
import type { ParsedBrokerHoldings } from "../lib/brokerHoldings/types";
import {
  clearBrokerAuth,
  hasOAuthToken,
  listenOAuthComplete,
  saveSessionId,
} from "../lib/brokerAuth";
import { listBrokerSyncs, removeBrokerSync, saveBrokerSync, type SavedBrokerSync } from "../lib/brokerLibrary";
import {
  callBrokerTool,
  connectBroker,
  disconnectBroker,
  listBrokerServers,
  startBrokerOAuth,
  type BrokerServerInfo,
} from "../lib/brokerMcpApi";
import { BROKERS, type BrokerId } from "../lib/brokers";

export type BrokerConnectionState = {
  connected: boolean;
  authorized: boolean;
  loginUrl: string | null;
  busy: boolean;
  status: string;
  lastSync: SavedBrokerSync | null;
};

function initialStates(): Record<BrokerId, BrokerConnectionState> {
  return Object.fromEntries(
    BROKERS.map((b) => [
      b.id,
      {
        connected: false,
        authorized: b.auth === "oauth" ? hasOAuthToken(b.id) : true,
        loginUrl: null,
        busy: false,
        status: "",
        lastSync: null,
      },
    ]),
  ) as Record<BrokerId, BrokerConnectionState>;
}

export function useBrokerMcp() {
  const [servers, setServers] = useState<BrokerServerInfo[]>([]);
  const [brokerSyncs, setBrokerSyncs] = useState<SavedBrokerSync[]>([]);
  const [states, setStates] = useState(initialStates);
  const [hydrating, setHydrating] = useState(true);

  const patchState = useCallback((id: BrokerId, patch: Partial<BrokerConnectionState>) => {
    setStates((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  const refresh = useCallback(async () => {
    const [serverList, syncs] = await Promise.all([listBrokerServers(), listBrokerSyncs()]);
    setServers(serverList);
    setBrokerSyncs(syncs);
    setStates((prev) => {
      const next = { ...prev };
      for (const b of BROKERS) {
        const srv = serverList.find((s) => s.id === b.id);
        const sync = syncs.find((s) => s.brokerId === b.id) ?? null;
        next[b.id] = {
          ...next[b.id],
          connected: Boolean(srv?.connected),
          authorized: b.auth === "oauth" ? hasOAuthToken(b.id) : true,
          lastSync: sync,
        };
      }
      return next;
    });
  }, []);

  useEffect(() => {
    void refresh().finally(() => setHydrating(false));
  }, [refresh]);

  useEffect(() => {
    return listenOAuthComplete((payload) => {
      if (payload.serverId && BROKERS.some((b) => b.id === payload.serverId)) {
        const id = payload.serverId as BrokerId;
        if (payload.error) {
          patchState(id, { status: payload.error, authorized: false });
        } else {
          patchState(id, { authorized: true, status: "Authorized. Tap Connect to continue." });
        }
      }
    });
  }, [patchState]);

  const authorize = useCallback(
    async (id: BrokerId) => {
      patchState(id, { busy: true, status: "Opening INDmoney sign-in…" });
      try {
        const { authUrl } = await startBrokerOAuth(id);
        window.open(authUrl, "_blank", "noopener,noreferrer");
        patchState(id, { status: "Complete sign-in in the browser tab, then return here." });
      } catch (e) {
        patchState(id, { status: String(e) });
        throw e;
      } finally {
        patchState(id, { busy: false });
      }
    },
    [patchState],
  );

  const connect = useCallback(
    async (id: BrokerId) => {
      patchState(id, { busy: true, status: "Connecting to MCP…" });
      try {
        const result = await connectBroker(id);
        if (result.sessionId) saveSessionId(id, result.sessionId);
        patchState(id, {
          connected: true,
          status: id === "kite" ? "Connected. Run Zerodha login next." : "Connected. Ready to sync holdings.",
        });
        await refresh();
      } catch (e) {
        patchState(id, { status: String(e), connected: false });
        throw e;
      } finally {
        patchState(id, { busy: false });
      }
    },
    [patchState, refresh],
  );

  const disconnect = useCallback(
    async (id: BrokerId) => {
      patchState(id, { busy: true, status: "Disconnecting…" });
      try {
        await disconnectBroker(id);
        clearBrokerAuth(id);
        patchState(id, {
          connected: false,
          authorized: false,
          loginUrl: null,
          status: "",
        });
        await refresh();
      } finally {
        patchState(id, { busy: false });
      }
    },
    [patchState, refresh],
  );

  const zerodhaLogin = useCallback(
    async (id: BrokerId) => {
      patchState(id, { busy: true, status: "Requesting login URL…" });
      try {
        const result = await callBrokerTool(id, "login", {});
        const loginUrl = extractLoginUrl(result);
        patchState(id, {
          loginUrl,
          status: loginUrl
            ? "Open the login link and complete Kite 2FA in your browser."
            : "Login tool ran. If holdings fail, run login again.",
        });
      } catch (e) {
        patchState(id, { status: String(e) });
        throw e;
      } finally {
        patchState(id, { busy: false });
      }
    },
    [patchState],
  );

  const syncHoldings = useCallback(
    async (id: BrokerId) => {
      patchState(id, { busy: true, status: "Fetching holdings…" });
      try {
        let parsed: ParsedBrokerHoldings | null = null;

        if (id === "kite") {
          const parts: ParsedBrokerHoldings[] = [];
          for (const tool of ["get_holdings", "get_mf_holdings"] as const) {
            patchState(id, { status: `Fetching ${tool}…` });
            try {
              const result = await callBrokerTool(id, tool, {});
              const p = parseBrokerHoldings(result);
              if (p) parts.push(p);
            } catch (e) {
              if (tool === "get_holdings") throw e;
            }
          }
          parsed = mergeParsedHoldings(parts);
          if (!parsed) throw new Error("No holdings returned. Complete Zerodha login first.");
        } else if (id === "indmoney") {
          const parts: ParsedBrokerHoldings[] = [];
          for (const assetType of INDMONEY_ASSET_TYPES) {
            patchState(id, { status: `Fetching ${assetType} holdings…` });
            try {
              const result = await callBrokerTool(id, "networth_holdings", { asset_type: assetType });
              const p = parseBrokerHoldings(result);
              if (p?.holdings.length) parts.push(p);
            } catch {
              // skip unsupported asset types
            }
          }
          parsed = mergeParsedHoldings(parts);
          if (!parsed) throw new Error("No holdings returned from INDmoney.");
        }

        if (!parsed) throw new Error("Could not parse holdings.");

        const label = id === "kite" ? "Zerodha (live)" : "INDmoney (live)";
        const saved = await saveBrokerSync(id, label, parsed);
        patchState(id, { lastSync: saved, status: `Synced ${parsed.holdings.length} holdings.` });
        await refresh();
        return saved;
      } catch (e) {
        patchState(id, { status: String(e) });
        throw e;
      } finally {
        patchState(id, { busy: false });
      }
    },
    [patchState, refresh],
  );

  const removeSync = useCallback(
    async (syncId: string) => {
      await removeBrokerSync(syncId);
      await refresh();
    },
    [refresh],
  );

  return {
    servers,
    brokerSyncs,
    states,
    hydrating,
    authorize,
    connect,
    disconnect,
    zerodhaLogin,
    syncHoldings,
    removeSync,
    refresh,
  };
}
