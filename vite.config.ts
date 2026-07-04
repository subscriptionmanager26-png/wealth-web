import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vendorMobile = path.resolve(__dirname, "mobile-vendor");
const mobileApp = existsSync(vendorMobile)
  ? vendorMobile
  : path.resolve(__dirname, "../mobile-app");
const amfiNavApiWeb = path.resolve(__dirname, "src/bridge/amfiNavApi.web.ts");

function webAmfiBridges() {
  return {
    name: "web-amfi-bridges",
    enforce: "pre",
    resolveId(source, importer) {
      const isAmfiNavModule =
        source === "./amfiNavApi" ||
        source.endsWith("/amfiNavApi") ||
        source.endsWith("/amfiNavApi.ts") ||
        source.endsWith("/utils/amfiNavApi.ts") ||
        source.endsWith("\\utils\\amfiNavApi.ts");
      if (isAmfiNavModule) {
        return amfiNavApiWeb;
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [react(), webAmfiBridges()],
  resolve: {
    alias: [
      { find: "@react-native-async-storage/async-storage", replacement: path.resolve(__dirname, "src/shims/async-storage.ts") },
      { find: "expo-asset", replacement: path.resolve(__dirname, "src/shims/expo-asset.ts") },
      { find: "expo-file-system/legacy", replacement: path.resolve(__dirname, "src/shims/expo-file-system.ts") },
      { find: path.join(mobileApp, "utils/niftyBenchmarkApi.ts"), replacement: path.resolve(__dirname, "src/bridge/niftyBenchmarkApi.web.ts") },
      { find: path.join(mobileApp, "utils/amfiNavApi.ts"), replacement: path.resolve(__dirname, "src/bridge/amfiNavApi.web.ts") },
      { find: path.join(mobileApp, "utils/benchmarkService.ts"), replacement: path.resolve(__dirname, "src/bridge/benchmarkService.web.ts") },
      { find: path.join(mobileApp, "utils/amfiSchemeMap.ts"), replacement: path.resolve(__dirname, "src/bridge/amfiSchemeMap.web.ts") },
      {
        find: "@mobile/utils/portfolioNavCache",
        replacement: path.resolve(__dirname, "src/bridge/portfolioNavCache.web.ts"),
      },
      {
        find: path.join(mobileApp, "utils/portfolioNavCache.ts"),
        replacement: path.resolve(__dirname, "src/bridge/portfolioNavCache.web.ts"),
      },
      {
        find: path.join(mobileApp, "utils/navSeriesDiskCache.ts"),
        replacement: path.resolve(__dirname, "src/bridge/navSeriesDiskCache.web.ts"),
      },
      { find: "@mobile", replacement: mobileApp },
    ],
  },
  server: {
    fs: { allow: [path.resolve(__dirname, "..")] },
    proxy: {
      "/api/nifty/tri": { target: "http://127.0.0.1:3457", changeOrigin: true },
      "/api/amfi/nav-history": { target: "http://127.0.0.1:3457", changeOrigin: true },
      "/api/amfi/portal-nav": { target: "http://127.0.0.1:3457", changeOrigin: true },
      "/api/portfolio/chat": { target: "http://127.0.0.1:3457", changeOrigin: true },
      "/api/broker/": { target: "http://127.0.0.1:3457", changeOrigin: true },
    },
  },
  optimizeDeps: {
    include: ["decimal.js"],
  },
});
