// ─────────────────────────────────────────────────────────────────
//  docker-start.js — Entrypoint do container
//
//  Roda em foreground (não destaca processos) e faz signal forwarding
//  para que `docker stop` encerre tudo limpo.
//
//  Pipeline de startup (paridade com scripts/start.js no host):
//    0. repo-health  — aborta se encontrar código quebrado
//    1. update-rules — refresca Fear/Greed + preços em rules.json
//    2. API server        (:3001)
//    3. Scanner           (cron interno)
//    4. Monitor           (polling 30s)
//    5. Dashboard estático (:3000) + proxy /api/* → :3001
//
//  Por que o proxy /api existe:
//    O dashboard (useLiveData.js, ScanResultsGrid.jsx, WatchlistPanel.jsx)
//    usa URLs relativas "/api/..." — no `npm start` isso funciona porque
//    o Vite dev server tem um proxy no vite.config.js. No container o
//    dashboard é servido como estático, então este arquivo reimplementa
//    o mesmo proxy — sem ele, as chamadas de API do dashboard dão 404
//    e a UI aparece "vazia" / "versão antiga".
//
//  Se qualquer serviço crítico morre com exit code ≠ 0, derruba todos
//  (fail fast).
// ─────────────────────────────────────────────────────────────────

import { spawn, execSync } from "child_process";
import { createServer, request as httpRequest } from "http";
import { readFileSync, statSync, existsSync } from "fs";
import { resolve, join, extname } from "path";

const ROOT      = resolve(process.cwd());
const DASH_DIR  = resolve(ROOT, "dashboard", "dist");
const DASH_PORT = parseInt(process.env.DASHBOARD_PORT || "3000", 10);
const API_PORT  = parseInt(process.env.API_PORT || "3001", 10);

// ── Step 0: repo-health ──────────────────────────────────────────
// Aborta antes de subir qualquer serviço se encontrar null bytes,
// truncamento ou sintaxe inválida. Evita rodar bot com código quebrado.
console.log("[docker-start] 0/5 Verificando integridade do repo…");
try {
  execSync("node scripts/repo-health.js --quiet", {
    cwd: ROOT,
    stdio: "inherit",
  });
  console.log("[docker-start]     ✓ Repo saudável");
} catch {
  console.error("[docker-start]     ✗ repo-health falhou — abortando startup.");
  console.error("[docker-start]       Rode 'docker compose exec app node scripts/repo-health.js' para detalhes.");
  process.exit(1);
}

// ── Step 1: update-rules (não-fatal) ─────────────────────────────
// Fear/Greed + preços. Se falhar (rede indisponível, rate-limit),
// continua com o rules.json atual — não derruba o stack.
console.log("[docker-start] 1/5 Atualizando rules.json…");
try {
  execSync("node scripts/update-rules.js", {
    cwd: ROOT,
    stdio: "inherit",
  });
  console.log("[docker-start]     ✓ rules.json atualizado");
} catch (err) {
  console.warn("[docker-start]     ⚠ update-rules falhou (continuando com rules.json existente):", err.message);
}

// ── MIME types para o dashboard estático ─────────────────────────
const MIME = {
  ".html":  "text/html; charset=utf-8",
  ".js":    "application/javascript; charset=utf-8",
  ".mjs":   "application/javascript; charset=utf-8",
  ".css":   "text/css; charset=utf-8",
  ".json":  "application/json; charset=utf-8",
  ".svg":   "image/svg+xml",
  ".png":   "image/png",
  ".jpg":   "image/jpeg",
  ".jpeg":  "image/jpeg",
  ".gif":   "image/gif",
  ".ico":   "image/x-icon",
  ".map":   "application/json",
  ".woff":  "font/woff",
  ".woff2": "font/woff2",
  ".ttf":   "font/ttf",
  ".txt":   "text/plain; charset=utf-8",
};

// ── Proxy reverso: /api/* → http://127.0.0.1:API_PORT/api/* ──────
function proxyApi(req, res) {
  const opts = {
    hostname: "127.0.0.1",
    port: API_PORT,
    path: req.url,      // mantém "/api/..." tal qual veio
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${API_PORT}` },
  };
  const upstream = httpRequest(opts, (apiRes) => {
    res.writeHead(apiRes.statusCode || 502, apiRes.headers);
    apiRes.pipe(res);
  });
  upstream.on("error", (err) => {
    res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "api_unreachable", detail: err.message }));
  });
  req.pipe(upstream);
}

// ── Static file server + SPA fallback ────────────────────────────
function serveDashboard() {
  if (!existsSync(DASH_DIR)) {
    console.warn(`[docker-start] Dashboard dist não encontrado em ${DASH_DIR} — skip.`);
    return null;
  }

  const server = createServer((req, res) => {
    const rawUrl = req.url || "/";

    // 1) Tudo que começa com /api vai para o API server via proxy.
    if (rawUrl === "/api" || rawUrl.startsWith("/api/") || rawUrl.startsWith("/api?")) {
      return proxyApi(req, res);
    }

    // 2) Resto: servir arquivo estático do dist.
    const urlPath = decodeURIComponent(rawUrl.split("?")[0]);
    let filePath  = join(DASH_DIR, urlPath === "/" ? "index.html" : urlPath);

    try {
      if (statSync(filePath).isDirectory()) filePath = join(filePath, "index.html");
    } catch {
      // SPA fallback: qualquer rota desconhecida serve index.html.
      filePath = join(DASH_DIR, "index.html");
    }

    try {
      const body = readFileSync(filePath);
      res.writeHead(200, {
        "Content-Type": MIME[extname(filePath)] || "application/octet-stream",
      });
      res.end(body);
    } catch {
      res.writeHead(404); res.end("404");
    }
  });

  server.listen(DASH_PORT, () => {
    console.log(`[docker-start] Dashboard estático + proxy /api → :${API_PORT} em http://0.0.0.0:${DASH_PORT}`);
  });
  return server;
}

// ── Node 22: node:sqlite experimental flag ───────────────────────
// `src/storage/db.js` importa `node:sqlite`. Em Node 22.5 – 22.10 é
// experimental e exige --experimental-sqlite. Em 22.11+ e 23+ o flag
// é ignorado (no-op). Passar sempre é seguro e evita crash em imagens
// mais antigas de node:22-alpine.
const NODE_FLAGS = ["--experimental-sqlite"];

// ── Spawn de serviços ────────────────────────────────────────────
const children = [];

function spawnService(name, args) {
  const fullArgs = [...NODE_FLAGS, ...args];
  console.log(`[docker-start] start ${name}: node ${fullArgs.join(" ")}`);
  const child = spawn(process.execPath, fullArgs, {
    cwd: ROOT,
    stdio: "inherit",
    env:  process.env,
  });
  child.on("exit", (code, signal) => {
    console.log(`[docker-start] ${name} exited code=${code} signal=${signal}`);
    // Fail fast: derruba todo o stack se qualquer serviço crítico cair.
    shutdown(code ?? 1);
  });
  children.push({ name, child });
  return child;
}

function shutdown(exitCode = 0) {
  console.log(`[docker-start] shutdown (exit ${exitCode})…`);
  for (const { child } of children) {
    try { child.kill("SIGTERM"); } catch { /* ignore */ }
  }
  setTimeout(() => process.exit(exitCode), 2000);
}

process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT",  () => shutdown(0));

// ── Ordem de subida ──────────────────────────────────────────────
// API primeiro (o scanner e o monitor vão consultá-la).
spawnService("api", ["src/api/server.js"]);
setTimeout(() => spawnService("scanner", ["src/bot/scanner.js"]), 2000);
setTimeout(() => spawnService("monitor", ["src/bot/monitor.js"]), 2500);

// Dashboard estático roda dentro deste próprio processo — não spawna
// subprocess. Sobe imediatamente; quando o browser chamar /api/... o
// proxy já encontra o API server porque ele abriu a porta antes.
serveDashboard();

console.log("[docker-start] Todos os serviços iniciados. SIGTERM para parar.");
