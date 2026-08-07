import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import "./index.css";
import "katex/dist/katex.min.css";
import { installGlobalFetchDiagnostics } from "./lib/diagnosticsFetch";
import { diagLog, logEnvironmentSnapshot } from "./lib/diagnosticsLog";
import { initPostHog } from "./lib/posthog";

installGlobalFetchDiagnostics();
logEnvironmentSnapshot();
diagLog("session", "Application boot");

function deferAnalytics() {
  const run = () => {
    void initPostHog();
  };
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    window.requestIdleCallback(run, { timeout: 3000 });
  } else {
    setTimeout(run, 1500);
  }
}
deferAnalytics();

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    diagLog("session", `Document visibility → ${document.visibilityState}`);
  });
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => diagLog("session", "Browser online"));
  window.addEventListener("offline", () => diagLog("session", "Browser offline"));
  window.addEventListener("error", (ev) => {
    diagLog("session", "Uncaught error", {
      message: ev.message,
      filename: ev.filename,
      lineno: ev.lineno,
    });
  });
  window.addEventListener("unhandledrejection", (ev) => {
    diagLog("session", "Unhandled promise rejection", {
      reason: String(ev.reason),
    });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
