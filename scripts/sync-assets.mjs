import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const mobileAssets = existsSync(path.resolve(root, "../mobile-app/assets"))
  ? path.resolve(root, "../mobile-app/assets")
  : path.resolve(root, "mobile-vendor/assets");
const webAssets = path.resolve(root, "assets");
const publicDir = path.resolve(root, "public");

mkdirSync(publicDir, { recursive: true });

const files = [
  "unique_schemes.csv",
  "benchmark-seed.json",
  "benchmark-seed-meta.json",
  "amfi_active_schemes.csv",
  "screener-snapshot.json",
];
for (const f of files) {
  const src = existsSync(path.join(webAssets, f))
    ? path.join(webAssets, f)
    : path.join(mobileAssets, f);
  const dst = path.join(publicDir, f);
  if (!existsSync(src)) {
    console.warn(`[sync-assets] missing ${src}`);
    continue;
  }
  copyFileSync(src, dst);
  console.log(`[sync-assets] ${f}`);
}
