import { createContext, useContext } from "react";

import type { ToolDataStore } from "../portfolioTools/toolData";

const ToolDataContext = createContext<ToolDataStore | null>(null);

export function ToolDataProvider({
  value,
  children,
}: {
  value: ToolDataStore | null | undefined;
  children: React.ReactNode;
}) {
  return <ToolDataContext.Provider value={value ?? null}>{children}</ToolDataContext.Provider>;
}

export function useToolData(): ToolDataStore | null {
  return useContext(ToolDataContext);
}
