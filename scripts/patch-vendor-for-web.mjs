/** Web-only patches on mobile-vendor (never touches mobile-app). */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vendorRoot = path.resolve(__dirname, "../mobile-vendor");
const coreFile = path.join(vendorRoot, "utils/amfiResolveCore.ts");
const navApiFile = path.join(vendorRoot, "utils/amfiNavApi.ts");

const PORTAL_DIRECT =
  'export const AMFI_PORTAL_NAV_URL = "https://portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx";';
const PORTAL_PROXY = 'export const AMFI_PORTAL_NAV_URL = "/api/amfi/portal-nav";';
const NAV_API_DIRECT = 'const AMFI_NAV_HISTORY = "https://www.amfiindia.com/api/nav-history";';
const NAV_API_PROXY = 'const AMFI_NAV_HISTORY = "/api/amfi/nav-history";';

function patchFile(filePath, direct, proxied, label) {
  if (!existsSync(filePath)) {
    console.warn(`[patch-vendor-for-web] skip ${label} — missing ${filePath}`);
    return;
  }
  let text = readFileSync(filePath, "utf8");
  if (text.includes(proxied)) {
    console.log(`[patch-vendor-for-web] ${label} already proxied`);
    return;
  }
  if (!text.includes(direct)) {
    console.warn(`[patch-vendor-for-web] ${label} pattern not found`);
    return;
  }
  writeFileSync(filePath, text.replace(direct, proxied));
  console.log(`[patch-vendor-for-web] ${label} -> proxied`);
}

patchFile(coreFile, PORTAL_DIRECT, PORTAL_PROXY, "AMFI portal");
patchFile(navApiFile, NAV_API_DIRECT, NAV_API_PROXY, "AMFI nav-history");
