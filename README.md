# Wealth Web

Browser companion to the Saffron mobile app. **Does not modify `mobile-app/`** — imports shared logic from `../mobile-app/utils` and `../mobile-app/parser` via Vite aliases.

## Data sources (unchanged from mobile)

| API | Browser | Web route |
|-----|---------|-----------|
| Upvaly | Direct | Direct |
| mfapi.in | Direct | Direct |
| Nifty TRI | Blocked (CORS) | `POST /api/nifty/tri` → proxy |
| AMFI NAV history | Blocked (CORS) | `GET /api/amfi/nav-history` → proxy |

The proxy forwards the **same headers and query/body** as the mobile app.

## Production

**Live:** https://wealth-web-zeta.vercel.app

Deployed on Vercel (static SPA + serverless API proxy). The `mobile-vendor/` folder is a snapshot of `mobile-app` logic used at build time — refresh it before deploy when mobile logic changes:

```bash
npm run vendor-mobile
npx vercel deploy --prod
```

Alternative: Render/Docker using `npm run build && npm start` (see `Dockerfile`, `render.yaml`).

## Setup

```bash
cd pdf-parser/wealth-web
npm install
npm run dev
```

Open http://localhost:5173 (Vite proxies `/api/*` to the CORS proxy on port 3457).

## Production

```bash
npm run build
npm run preview
```

Serves static files + API proxy on http://127.0.0.1:3457.

## Upload flow

1. Drop a CAS PDF (password optional)
2. PDF.js extracts text in-browser
3. Same CAS parser + AMFI resolver + NAV analytics as mobile
4. Data persisted in IndexedDB + localStorage (browser-only)
