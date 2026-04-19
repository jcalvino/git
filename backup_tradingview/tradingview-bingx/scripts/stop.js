// ─────────────────────────────────────────────────────────────────
//  stop.js — Para todos os serviços do trader
//  1. Mata processos pelo PID salvo em data/pids.json
//  2. Garante limpeza das portas 3000 e 3001 mesmo sem pids.json
//     (cobre crash, Ctrl+C, reinicializações parciais)
//
//  Usage: node scripts/stop.js
// ─────────────────────────────────────────────────────────────────

import { readFileSync, existsSync, unlinkSync } from "fs";
import { execSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PIDS_FILE = resolve(ROOT, "data/pids.json");

console.log("╔══════════════════════════════════════════╗");
console.log("║     BTC/ETH Trader — Parando serviços    ║");
console.log("╚══════════════════════════════════════════╝\n");

// ── Step 1: Kill by saved PIDs ────────────────────────────────
if (existsSync(PIDS_FILE)) {
  let pids;
  try {
    pids = JSON.parse(readFileSync(PIDS_FILE, "utf8"));
  } catch {
    console.warn("  Aviso: data/pids.json corrompido — pulando kill por PID.\n");
    pids = {};
  }

  if (pids.startedAt) console.log(`  Iniciado em: ${pids.startedAt}\n`);

  const services = ["api", "scanner", "monitor", "dashboard"];
  for (const name of services) {
    const pid = pids[name];
    if (!pid) continue;
    try {
      if (process.platform === "win32") {
        execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore" });
      } else {
        process.kill(-pid, "SIGTERM");
      }
      console.log(`  ✓ ${name.padEnd(10)} parado  (PID ${pid})`);
    } catch {
      console.log(`  - ${name.padEnd(10)} já parado (PID ${pid})`);
    }
  }

  try { unlinkSync(PIDS_FILE); } catch { /* ignore */ }
  console.log();
} else {
  console.log("  data/pids.json não encontrado — verificando portas diretamente.\n");
}

// ── Step 2: Force-kill anything still on ports 3000/3001 ─────
// Covers crashes, Ctrl+C, or processes that survived the PID kill.
const PORTS = [3000, 3001];

for (const port of PORTS) {
  const pidsOnPort = getPidsOnPort(port);
  if (pidsOnPort.length === 0) {
    console.log(`  ✓ Porta ${port}  livre`);
    continue;
  }
  for (const pid of pidsOnPort) {
    try {
      if (process.platform === "win32") {
        execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore" });
      } else {
        execSync(`kill -9 ${pid}`, { stdio: "ignore" });
      }
      console.log(`  ✓ Porta ${port}  liberada (PID ${pid} encerrado)`);
    } catch {
      console.log(`  - Porta ${port}  PID ${pid} já encerrado`);
    }
  }
}

console.log("\n  Todas as portas liberadas.");
console.log("  Para reiniciar: node scripts/start.js\n");

// ── Helper: find PIDs using a TCP port ───────────────────────
function getPidsOnPort(port) {
  try {
    if (process.platform === "win32") {
      // netstat output: "  TCP  0.0.0.0:3001  ...  LISTENING  12345"
      const out = execSync(`netstat -ano`, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] });
      const pids = new Set();
      for (const line of out.split("\n")) {
        if (line.includes(`:${port} `) && (line.includes("LISTENING") || line.includes("ESTABLISHED"))) {
          const parts = line.trim().split(/\s+/);
          const pid = parseInt(parts[parts.length - 1], 10);
          if (!isNaN(pid) && pid > 0) pids.add(pid);
        }
      }
      return [...pids];
    } else {
      const out = execSync(`lsof -ti tcp:${port}`, { encoding: "utf8" });
      return out.trim().split("\n").filter(Boolean).map(Number);
    }
  } catch {
    return [];
  }
}
