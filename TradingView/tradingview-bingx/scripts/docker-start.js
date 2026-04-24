// ─────────────────────────────────────────────────────────────────
//  docker-start.js — Entrypoint do container
//
//  Roda em foreground (não destaca processos) e faz signal forwarding
//  para que `docker stop` encerre tudo limpo.
//
//  Serviços:
//    1. API server  (:3001)
//    2. Scanner     (cron interno)
//    3. Monitor     (polling 30s)
//    4. Dashboard   (serve-static /app/dashboard/dist em :3000)
//
//  Se qualquer um morre com exit code ≠ 0, derruba todos (fail fast).
// ─────────────────────────────────────────────────────────────────

import { spawn } from "child_process";
import { createServer } from "http";
import { readFileSync, statSync, existsSync } from "fs";
import { resolve, join, extname } from "path";

const ROOT      = resolve(process.cwd());
const DASH_DIR  = resolve(ROOT, "dashboard", "dist");
const DASH_PORT = parseInt(process.env.DASHBOARD_PORT || "3000", 10);

// ── Static file server for built dashboard ───────────────────────
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".ico":  "image/x-icon",
  ".map":  "application/json",
  ".woff": "font/woff",
  ".woff2":"font/woff2",
};

function serveDashboard() {
  if (!existsSync(DASH_DIR)) {
    console.warn(`[docker-start] Dashboard dist não encontrado em ${DASH_DIR} — skip.`);
    return null;
  }
  const server = createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    let filePath  = join(DASH_DIR, urlPath === "/" ? "index.html" : urlPath);
    try {
      if (statSync(filePath).isDirectory()) filePath = join(filePath, "index.html");
    } catch {
      // SPA fallback: qualquer rota desconhecida serve index.html
      filePath = join(DASH_DIR, "index.html");
    }
    try {
      const body = readFileSync(filePath);
      res.writeHead(200, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream" });
      res.end(body);
    } catch (err) {
      res.writeHead(404); res.end("404");
    }
  });
  server.listen(DASH_PORT, () => {
    console.log(`[docker-start] Dashboard static em http://0.0.0.0:${DASH_PORT}`);
  });
  return server;
}

// ── Node 22: node:sqlite experimental flag ───────────────────────
// `src/storage/db.js` importa `node:sqlite`. Em Node 22.5 – 22.10 é
// experimental e exige --experimental-sqlite. Em 22.11+ e 23+ o
// flag é ignorado (no-op). Passar sempre é seguro nas versões
// atuais e evita crash em imagens mais antigas de node:22-alpine.
const NODE_FLAGS = ["--experimental-sqlite"];

// ── Spawn wrappers ───────────────────────────────────────────────
const children = [];

function spawnService(name, args) {
  const fullArgs = [...NODE_FLAGS, ...args];
  console.log(`[docker-start] start ${name}: node ${fullArgs.join(" ")}`);
  const child = spawn(process.execPath, fullArgs, {
    cwd: ROOT,
    stdio: "inherit",
    env:   process.env,
  });
  child.on("exit", (code, signal) => {
    console.log(`[docker-start] ${name} exited code=${code} signal=${signal}`);
    // Fail fast: derruba todo o stack se qualquer serviço crítico cair
    shutdown(code ?? 1);
  });
  children.push({ name, child });
  return child;
}

function shutdown(exitCode = 0) {
  console.log(`[docker-start] shutdown (exit ${exitCode})…`);
  for (const { name, child } of children) {
    try { child.kill("SIGTERM"); } catch { /* ignore */ }
  }
  setTimeout(() => process.exit(exitCode), 2000);
}

process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT",  () => shutdown(0));

// ── Start services in order ─────────────────────────────────────
spawnService("api",     ["src/api/server.js"]);
// Pequeno delay para API abrir a porta antes do scanner consultá-la
setTimeout(() => spawnService("scanner", ["src/bot/scanner.js"]), 2000);
setTimeout(() => spawnService("monitor", ["src/bot/monitor.js"]), 2500);

// Dashboard estático (dentro do próprio processo node — não spawna subprocess)
serveDashboard();

console.log("[docker-start] Todos os serviços iniciados. Ctrl+C para parar.");
