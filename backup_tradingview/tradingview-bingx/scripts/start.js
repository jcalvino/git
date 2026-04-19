// ─────────────────────────────────────────────────────────────────
//  start.js — Daily startup script
//  0. Starts TradingView Desktop with --remote-debugging-port=9222
//  1. Updates rules.json (Fear/Greed + prices)
//  2. Starts API server    → data/api.log
//  3. Starts Scanner       → data/scanner.log   (cron every 4h)
//  4. Starts Monitor       → data/monitor.log   (SL/TP every 30s)
//  5. Starts Dashboard     → data/dashboard.log (localhost:3000)
//
//  Usage: node scripts/start.js
//  Stop:  node scripts/stop.js
// ─────────────────────────────────────────────────────────────────

import { spawn, execSync } from "child_process";
import { writeFileSync, readFileSync, mkdirSync, existsSync, openSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import http from "http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "data");
const PIDS_FILE = resolve(DATA_DIR, "pids.json");

// Ensure data dir exists
mkdirSync(DATA_DIR, { recursive: true });

// ── Helper: free a TCP port by killing its owner ───────────────
function killPort(port) {
  try {
    if (process.platform === "win32") {
      const out = execSync(`netstat -ano`, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] });
      const pids = new Set();
      for (const line of out.split("\n")) {
        if (line.includes(`:${port} `) && (line.includes("LISTENING") || line.includes("ESTABLISHED"))) {
          const parts = line.trim().split(/\s+/);
          const pid = parseInt(parts[parts.length - 1], 10);
          if (!isNaN(pid) && pid > 0) pids.add(pid);
        }
      }
      for (const pid of pids) {
        try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore" }); } catch { /* already gone */ }
      }
    } else {
      execSync(`lsof -ti tcp:${port} | xargs -r kill -9`, { stdio: "ignore" });
    }
  } catch { /* port already free */ }
}

console.log("╔══════════════════════════════════════════╗");
console.log("║     BTC/ETH Trader — Starting Up         ║");
console.log("╚══════════════════════════════════════════╝\n");

// ── Guard: check if already running ───────────────────────────
if (existsSync(PIDS_FILE)) {
  try {
    const existing = JSON.parse(readFileSync(PIDS_FILE, "utf8"));
    console.log("⚠  Serviços já estão rodando (data/pids.json encontrado).");
    console.log(`   Iniciado em: ${existing.startedAt}`);
    console.log("   Para reiniciar: node scripts/stop.js && node scripts/start.js\n");
    process.exit(0);
  } catch { /* corrupt pids.json — proceed */ }
}

// ── Step 0: TradingView Desktop ───────────────────────────────
const CDP_PORT = 9222;

async function isCdpReady() {
  return new Promise((resolve) => {
    http.get(`http://localhost:${CDP_PORT}/json/version`, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve(!!data));
    }).on("error", () => resolve(false));
  });
}

const cdpAlreadyUp = await isCdpReady();

// Finds TradingView.exe — handles both Store (WindowsApps) and standalone installs.
// Store version: uses Get-AppxPackage to get the current install dir (works without admin,
// and is version-number-agnostic — won't break on TradingView updates).
function findTradingViewExe() {
  // 1. Windows Store app via PowerShell (version-agnostic, no admin needed)
  try {
    const installDir = execSync(
      'powershell -NoProfile -Command "(Get-AppxPackage -Name TradingView.Desktop).InstallLocation"',
      { encoding: "utf8", timeout: 8000, windowsHide: true }
    ).trim();
    if (installDir) {
      const exePath = `${installDir}\\TradingView.exe`;
      if (existsSync(exePath)) return { path: exePath, source: "store" };
    }
  } catch { /* PowerShell not available or package not found */ }

  // 2. Classic standalone installer paths
  const standalonePaths = [
    process.env.LOCALAPPDATA   && `${process.env.LOCALAPPDATA}\\TradingView\\TradingView.exe`,
    process.env.PROGRAMFILES   && `${process.env.PROGRAMFILES}\\TradingView\\TradingView.exe`,
    process.env["PROGRAMFILES(X86)"] && `${process.env["PROGRAMFILES(X86)"]}\\TradingView\\TradingView.exe`,
  ].filter(Boolean);

  for (const p of standalonePaths) {
    if (existsSync(p)) return { path: p, source: "standalone" };
  }

  return null;
}

if (cdpAlreadyUp) {
  console.log("0/6  TradingView já está rodando com CDP na porta 9222 ✓\n");
} else {
  console.log("0/6  Iniciando TradingView Desktop...");

  const tv = findTradingViewExe();
  if (!tv) {
    console.error("     ✗ TradingView.exe não encontrado.");
    console.error("       Instale via Microsoft Store ou inicie manualmente com:");
    console.error(`         TradingView.exe --remote-debugging-port=${CDP_PORT}`);
    process.exit(1);
  }

  console.log(`     Encontrado (${tv.source}): ${tv.path}`);

  const child = spawn(tv.path, [`--remote-debugging-port=${CDP_PORT}`], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
  console.log(`     PID: ${child.pid} | aguardando CDP ficar pronto...`);

  let ready = false;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await isCdpReady()) { ready = true; break; }
    process.stdout.write(".");
  }
  if (!ready) {
    console.error("\n     ✗ TradingView iniciou mas CDP não respondeu em 20s.");
    console.error("       Verifique se o app abriu corretamente e tente novamente.");
    process.exit(1);
  }
  console.log(`\n     TradingView pronto com CDP na porta ${CDP_PORT} ✓\n`);
}

// ── Step 1: Update rules.json ──────────────────────────────────
console.log("1/6  Atualizando rules.json...");
try {
  execSync("node scripts/update-rules.js", { cwd: ROOT, stdio: "inherit" });
} catch (err) {
  console.warn("     ⚠  Falhou (continuando sem atualização):", err.message, "\n");
}

// ── Helper: spawn detached background process ──────────────────
function spawnBg(label, cmd, args, cwd) {
  const logPath = resolve(DATA_DIR, `${label}.log`);
  writeFileSync(logPath, `\n--- ${label} started at ${new Date().toISOString()} ---\n`, { flag: "a" });
  const logFd = openSync(logPath, "a");

  // On Windows, .cmd files (npm.cmd, npx.cmd) are batch scripts — they are NOT
  // native executables and cannot be spawned with shell:false. They require cmd.exe.
  // For native executables (node.exe), shell:false + windowsHide:true works perfectly.
  const isWindows = process.platform === "win32";
  const resolvedCmd = isWindows && cmd === "npm" ? "npm.cmd" : cmd;
  const needsShell = isWindows && resolvedCmd.endsWith(".cmd");

  const child = spawn(resolvedCmd, args, {
    cwd,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    windowsHide: true,
    shell: needsShell,
  });
  child.unref();
  return child.pid;
}

// ── Step 1.5: Free ports before starting ──────────────────────
console.log("1.5/6 Liberando portas 3000/3001...");
killPort(3000);
killPort(3001);
console.log("      Portas liberadas ✓\n");

// ── Step 2: API Server ─────────────────────────────────────────
console.log("2/6  Iniciando API server (porta 3001)...");
const apiPid = spawnBg("api", "node", ["src/api/server.js"], ROOT);
console.log(`     PID: ${apiPid} | log: data/api.log`);

// Brief pause so API is ready before scanner tries to write
await new Promise((r) => setTimeout(r, 1500));

// ── Step 3: Scanner (cron mode, every 4h) ─────────────────────
console.log("3/6  Iniciando scanner (cron a cada 4h)...");
const scannerPid = spawnBg("scanner", "node", ["src/bot/scanner.js"], ROOT);
console.log(`     PID: ${scannerPid} | log: data/scanner.log`);

// ── Step 4: Monitor (SL/TP a cada 30s) ───────────────────────
console.log("4/6  Iniciando monitor de posições...");
const monitorPid = spawnBg("monitor", "node", ["src/bot/monitor.js"], ROOT);
console.log(`     PID: ${monitorPid} | log: data/monitor.log`);

// ── Step 5: Dashboard (Vite :3000) ────────────────────────────
console.log("5/6  Iniciando dashboard (porta 3000)...");
const dashboardDir = resolve(ROOT, "dashboard");
const dashPid = spawnBg("dashboard", "npm", ["run", "dev"], dashboardDir);
console.log(`     PID: ${dashPid} | log: data/dashboard.log`);

// ── Step 6: Done ───────────────────────────────────────────────
console.log("\n6/6  Salvando PIDs...");

// ── Save PIDs ──────────────────────────────────────────────────
const pids = {
  api: apiPid,
  scanner: scannerPid,
  monitor: monitorPid,
  dashboard: dashPid,
  startedAt: new Date().toISOString(),
};
writeFileSync(PIDS_FILE, JSON.stringify(pids, null, 2));

// ── Summary ────────────────────────────────────────────────────
console.log("\n╔══════════════════════════════════════════╗");
console.log("║  Todos os serviços estão rodando         ║");
console.log("╚══════════════════════════════════════════╝");
console.log("");
console.log("  Dashboard : http://localhost:3000");
console.log("  API       : http://localhost:3001/api/health");
console.log("");
console.log("  Logs em tempo real:");
console.log("    Scanner  → type data\\scanner.log");
console.log("    API      → type data\\api.log");
console.log("    Monitor  → type data\\monitor.log");
console.log("");
console.log("  Para parar tudo: node scripts/stop.js");
console.log("");
