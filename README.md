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

**Recommended:** run the Node proxy server (`server/proxy.mjs`) via Docker or `npm run build && npm start`. This serves the static SPA and routes all `/api/*` calls (including Munshi chat) through one process — same architecture as local dev.

```bash
npm run vendor-mobile   # when mobile logic changed
npm run build
npm start               # http://0.0.0.0:8080
```

Docker (build context = `pdf-parser/` parent):

```bash
docker build -f wealth-web/Dockerfile -t wealth-web .
docker run -p 8080:8080 wealth-web
```

**Vercel (legacy):** https://wealth-web-zeta.vercel.app uses serverless `api/portfolio/chat.js` instead of `server/proxy.mjs`. Prefer Docker/`npm start` for Munshi chat to avoid serverless cold starts.

## Setup

```bash
cd pdf-parser/wealth-web
npm install
npm run dev
```

Open http://localhost:5173 (Vite proxies `/api/*` to `server/proxy.mjs` on port 3457).

## Local production preview

```bash
npm run build
npm run preview
```

Serves static files + API proxy on http://127.0.0.1:8080 (same `server/proxy.mjs` as Docker).

## Upload flow

1. Drop a CAS PDF (password optional)
2. PDF.js extracts text in-browser
3. Same CAS parser + AMFI resolver + NAV analytics as mobile
4. Data persisted in IndexedDB + localStorage (browser-only)
