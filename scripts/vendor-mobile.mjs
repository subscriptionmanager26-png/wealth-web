/** Copy mobile-app sources into wealth-web/.vendor for standalone cloud builds. */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const mobileApp = path.resolve(root, "../mobile-app");
const vendorRoot = path.resolve(root, "mobile-vendor");

const dirs = ["parser", "utils", "theme"];
const assetFiles = ["assets/unique_schemes.csv", "assets/benchmark-seed.json"];

if (!existsSync(mobileApp)) {
  const hasVendorAssets = existsSync(path.join(vendorRoot, "assets/benchmark-seed.json"));
  if (!hasVendorAssets) {
    console.error("[vendor-mobile] missing ../mobile-app and mobile-vendor/assets — run vendor-mobile locally first");
    process.exit(1);
  }
  console.log("[vendor-mobile] using committed mobile-vendor");
  process.exit(0);
}

rmSync(vendorRoot, { recursive: true, force: true });
mkdirSync(vendorRoot, { recursive: true });

for (const d of dirs) {
  cpSync(path.join(mobileApp, d), path.join(vendorRoot, d), { recursive: true });
}

mkdirSync(path.join(vendorRoot, "assets"), { recursive: true });
for (const f of assetFiles) {
  const src = path.join(mobileApp, f);
  if (existsSync(src)) {
    cpSync(src, path.join(vendorRoot, "assets", path.basename(f)));
  }
}

console.log("[vendor-mobile] copied mobile-app into mobile-vendor/");
