/**
 * Local demo for MF Central / CDSL / NPS / CAMS statement parsers.
 *
 *   npx tsx scripts/statement-demo-server.ts
 *
 * Open http://127.0.0.1:3847
 * PDFs are parsed in memory and never written to disk.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { parseAnyStatementFromLines } from "../mobile-vendor/parser/statementParser";
import { extractPdfLinesWithPdfJs } from "../mobile-vendor/parser/extractPdfLinesPdfjs";
import { parseCASFromExtractedLines } from "../mobile-vendor/parser/cas-parser";

const PORT = Number(process.env.STATEMENT_DEMO_PORT ?? 3847);
const HOST = process.env.STATEMENT_DEMO_HOST ?? "127.0.0.1";

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Statement Parser Demo</title>
  <style>
    :root {
      --bg: #0b1220;
      --card: #121a2b;
      --border: #243047;
      --text: #e8eefc;
      --muted: #93a4c3;
      --accent: #f59e0b;
      --ok: #34d399;
      --err: #f87171;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      background: radial-gradient(1200px 600px at 10% -10%, #1a2744, var(--bg));
      color: var(--text);
      min-height: 100vh;
    }
    .wrap { max-width: 1100px; margin: 0 auto; padding: 28px 18px 48px; }
    h1 { margin: 0 0 6px; font-size: 1.6rem; }
    .sub { color: var(--muted); margin-bottom: 22px; line-height: 1.45; }
    .grid { display: grid; grid-template-columns: 340px 1fr; gap: 16px; }
    @media (max-width: 860px) { .grid { grid-template-columns: 1fr; } }
    .card {
      background: color-mix(in srgb, var(--card) 92%, black);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 16px;
    }
    label { display: block; font-size: 0.82rem; color: var(--muted); margin: 12px 0 6px; }
    input[type="file"], input[type="password"], input[type="text"] {
      width: 100%;
      background: #0a1020;
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px 12px;
    }
    button {
      margin-top: 16px;
      width: 100%;
      border: 0;
      border-radius: 10px;
      padding: 12px 14px;
      font-weight: 700;
      cursor: pointer;
      background: linear-gradient(180deg, #fbbf24, var(--accent));
      color: #111827;
    }
    button:disabled { opacity: 0.55; cursor: wait; }
    .hint { font-size: 0.8rem; color: var(--muted); margin-top: 12px; line-height: 1.4; }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 700;
      background: #1f2937;
      border: 1px solid var(--border);
      margin-right: 8px;
    }
    .badge.ok { color: var(--ok); border-color: #065f46; background: #052e24; }
    .badge.err { color: var(--err); border-color: #7f1d1d; background: #2a0f0f; }
    .meta { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0 14px; }
    .stat {
      background: #0a1020;
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px 12px;
      min-width: 120px;
    }
    .stat b { display: block; font-size: 1.05rem; margin-top: 2px; }
    .stat span { color: var(--muted); font-size: 0.75rem; }
    pre {
      margin: 0;
      background: #070c16;
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px;
      overflow: auto;
      max-height: 70vh;
      font-size: 12px;
      line-height: 1.45;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .empty { color: var(--muted); padding: 24px 8px; }
    .errbox { color: var(--err); white-space: pre-wrap; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Statement Parser Demo</h1>
    <p class="sub">
      Upload a password-protected statement PDF. Parsing runs in memory on this machine only —
      nothing is saved to disk. Supports <b>MF Central</b>, <b>CDSL</b>, <b>NPS</b>, and <b>CAMS/KFin CAS</b>.
    </p>
    <div class="grid">
      <section class="card">
        <form id="form">
          <label for="file">Statement PDF</label>
          <input id="file" name="file" type="file" accept="application/pdf,.pdf" required />
          <label for="password">PDF password (usually PAN)</label>
          <input id="password" name="password" type="password" placeholder="e.g. ABCDE1234F" autocomplete="off" />
          <button id="btn" type="submit">Parse statement</button>
        </form>
        <p class="hint">
          Local only: <code>http://127.0.0.1:${PORT}</code><br/>
          Same text-line parsers used for mobile (pdf.js → TypeScript).
        </p>
      </section>
      <section class="card">
        <div id="status"><span class="badge">idle</span></div>
        <div id="summary" class="meta"></div>
        <div id="out" class="empty">Parsed JSON will appear here.</div>
      </section>
    </div>
  </div>
  <script>
    const form = document.getElementById("form");
    const btn = document.getElementById("btn");
    const statusEl = document.getElementById("status");
    const summaryEl = document.getElementById("summary");
    const outEl = document.getElementById("out");

    function setStatus(text, kind) {
      statusEl.innerHTML = '<span class="badge ' + (kind || "") + '">' + text + "</span>";
    }

    function summarize(payload) {
      const d = payload.data || payload;
      const kind = payload.kind || d.kind || "unknown";
      const stats = [];
      stats.push(["Kind", kind]);
      if (d.period_from || d.period_to) stats.push(["Period", (d.period_from || "?") + " → " + (d.period_to || "?")]);
      if (d.investor_name) stats.push(["Name", d.investor_name]);
      if (d.investor_pan) stats.push(["PAN", d.investor_pan]);
      if (d.total_portfolio_value_inr) stats.push(["Portfolio ₹", d.total_portfolio_value_inr]);
      if (d.pran) stats.push(["PRAN", d.pran]);
      if (d.holdings && kind !== "nps") stats.push(["MF holdings", String(d.holdings.length)]);
      if (d.holdings && kind === "nps") stats.push(["NPS schemes", String(d.holdings.length)]);
      if (d.tiers) stats.push(["NPS tiers", String(d.tiers.length)]);
      if (d.demat_holdings) stats.push(["Demat holdings", String(d.demat_holdings.length)]);
      if (d.mf_holdings) stats.push(["CDSL MF holdings", String(d.mf_holdings.length)]);
      if (d.nps_holdings) stats.push(["NPS holdings", String(d.nps_holdings.length)]);
      if (d.demat_transactions) stats.push(["Demat txns", String(d.demat_transactions.length)]);
      summaryEl.innerHTML = stats.map(([k, v]) =>
        '<div class="stat"><span>' + k + "</span><b>" + v + "</b></div>"
      ).join("");
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const file = document.getElementById("file").files[0];
      const password = document.getElementById("password").value;
      if (!file) return;
      btn.disabled = true;
      setStatus("parsing…");
      summaryEl.innerHTML = "";
      outEl.className = "empty";
      outEl.textContent = "Working…";
      try {
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const pdfBase64 = btoa(binary);
        const res = await fetch("/api/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pdfBase64, password, fileName: file.name }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || ("HTTP " + res.status));
        setStatus("ok · " + (json.kind || "parsed"), "ok");
        summarize(json);
        outEl.className = "";
        outEl.innerHTML = "<pre>" + escapeHtml(JSON.stringify(json, null, 2)) + "</pre>";
      } catch (err) {
        setStatus("error", "err");
        outEl.className = "errbox";
        outEl.textContent = err && err.message ? err.message : String(err);
      } finally {
        btn.disabled = false;
      }
    });

    function escapeHtml(s) {
      return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }
  </script>
</body>
</html>`;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(json);
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const buf = Buffer.from(b64, "base64");
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

async function handleParse(req: IncomingMessage, res: ServerResponse) {
  try {
    const raw = await readBody(req);
    const payload = JSON.parse(raw || "{}") as {
      pdfBase64?: string;
      password?: string;
      fileName?: string;
    };
    const pdfBase64 = payload.pdfBase64?.trim();
    if (!pdfBase64) {
      sendJson(res, 400, { error: "pdfBase64 is required" });
      return;
    }
    const fileName = payload.fileName?.trim() || "statement.pdf";
    const password = payload.password?.trim() || undefined;

    const lines = await extractPdfLinesWithPdfJs(base64ToArrayBuffer(pdfBase64), password);
    const result = parseAnyStatementFromLines(lines, fileName);

    if (result.kind === "cams_kfin_cas") {
      sendJson(res, 200, {
        kind: result.kind,
        lineCount: lines.length,
        data: result.data,
      });
      return;
    }
    if (result.kind === "unknown") {
      // Fall back to CAMS parser attempt for older formats
      try {
        const cams = parseCASFromExtractedLines(lines, fileName);
        if (cams.holdings?.length) {
          sendJson(res, 200, { kind: "cams_kfin_cas", lineCount: lines.length, data: cams });
          return;
        }
      } catch {
        /* ignore */
      }
      sendJson(res, 422, {
        kind: "unknown",
        error: result.reason,
        lineCount: lines.length,
        preview: lines.slice(0, 30),
      });
      return;
    }

    sendJson(res, 200, {
      kind: result.kind,
      lineCount: lines.length,
      data: result.data,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const passwordError =
      /password|encrypted|NeedPassword|IncorrectPassword/i.test(message)
        ? "PDF is encrypted or password is wrong."
        : message;
    sendJson(res, 500, { error: passwordError });
  }
}

const server = createServer(async (req, res) => {
  const url = req.url ?? "/";
  if (req.method === "GET" && (url === "/" || url.startsWith("/?"))) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(HTML);
    return;
  }
  if (req.method === "POST" && url === "/api/parse") {
    await handleParse(req, res);
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, HOST, () => {
  console.log(`Statement parser demo running at http://${HOST}:${PORT}`);
  console.log("Upload a PDF + password in the browser. Files stay in memory only.");
});
