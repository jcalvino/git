// ─────────────────────────────────────────────────────────────────
//  Configuration Loader
//  Loads .env, validates required variables, exports typed config.
// ─────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

// Load .env file
const envPath = resolve(ROOT, ".env");
if (existsSync(envPath)) {
  readFileSync(envPath, "utf8")
    .split("\n")
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) return;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (key && !process.env[key]) process.env[key] = value;
    });
} else {
  console.warn(
    "⚠  No .env file found. Copy .env.example to .env and fill in your values."
  );
}

// ── Helpers ────────────────────────────────────────────────────
function required(key) {
  const val = process.env[key];
  if (!val || val.includes("your_")) {
    throw new Error(
      `Missing required env variable: ${key}\n` +
        `  → Copy .env.example to .env and fill in the value.`
    );
  }
  return val;
}

function optional(key, defaultValue) {
  return process.env[key] ?? defaultValue;
}

function bool(key, defaultValue = false) {
  const val = process.env[key];
  if (val === undefined) return defaultValue;
  return val.toLowerCase() === "true" || val === "1";
}

function num(key, defaultValue) {
  const val = process.env[key];
  if (val === undefined) return defaultValue;
  const n = parseFloat(val);
  if (isNaN(n)) throw new Error(`${key} must be a number, got: "${val}"`);
  return n;
}

// ── Capital inicial (snapshot, não muda em runtime) ───────────
// Lido uma única vez do .env no boot. `refreshCapital()` usa esse
// valor como base imutável e soma o PnL realizado (em paper) ou
// substitui pelo saldo real da BingX (em live).
// Aceita CAPITAL_USDC (preferido) ou CAPITAL_USDT (legacy) como fallback.
export const INITIAL_CAPITAL = num("CAPITAL_USDC", num("CAPITAL_USDT", 200));

// ── Config Export ──────────────────────────────────────────────
export const config = {
  // Trading mode
  paperTrade: bool("PAPER_TRADE", true),

  // Capital efetivo em USDC. Mutável em runtime via `refreshCapital()`:
  //   - PAPER: INITIAL_CAPITAL + getTotalRealizedPnl() (compounding simulado)
  //   - LIVE:  saldo total real da conta BingX USDC-M
  // Nome do campo `capitalUsdt` mantido para não quebrar consumers.
  capitalUsdt: INITIAL_CAPITAL,
  maxRiskPct: num("MAX_RISK_PCT", 0.01),
  minScore: num("MIN_SCORE", 65),

  // BingX — TRADE key (Futures Read + Futures Trade only).
  // Requerida quando PAPER_TRADE=false.
  bingx: {
    apiKey: optional("BINGX_API_KEY", ""),
    secretKey: optional("BINGX_SECRET_KEY", ""),
    baseUrl: optional("BINGX_BASE_URL", "https://open-api.bingx.com"),
  },

  // Telegram — alertas e (Fase 2) comandos remotos.
  // allowedChatIds: lista separada por vírgula dos chat_ids que recebem
  // os alertas. Na Fase 2 essa mesma lista vira whitelist de quem pode
  // mandar comandos (/panic, /approve, …).
  telegram: {
    enabled: bool("TELEGRAM_ENABLED", false),
    token: optional("TELEGRAM_BOT_TOKEN", ""),
    allowedChatIds: optional("TELEGRAM_ALLOWED_CHAT_IDS", "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  },

  // Bot schedule
  scanCron: optional("SCAN_CRON", "0 */4 * * *"),

  // Server
  apiPort: num("API_PORT", 3001),
  dashboardPort: num("DASHBOARD_PORT", 3000),

  // CoinGlass
  coinglassApiKey: optional("COINGLASS_API_KEY", ""),

  // Paths
  tvRulesPath: resolve(
    ROOT,
    optional("TV_RULES_PATH", "./rules.json")
  ),
  dbPath: resolve(ROOT, optional("DB_PATH", "./data/trades.db")),
};

// ── Live Capital Refresh ──────────────────────────────────────
// Call before each scan or before position sizing to ensure the
// effective capital is up to date.
//
//   PAPER mode → INITIAL_CAPITAL + soma do P&L realizado de todos os
//                trades fechados (CLOSED ou STOPPED). Reflete o efeito
//                de compounding dos trades simulados pra que o sizing
//                dos próximos use o capital atualizado em vez do valor
//                congelado do .env.
//
//   LIVE mode  → saldo total real da conta BingX USDC-M (preferindo
//                bal.total, com fallback pra bal.available). O PnL
//                realizado já está embutido no saldo, não soma duas
//                vezes.
//
// Em qualquer falha (DB ainda não inicializado, BingX offline), volta
// ao INITIAL_CAPITAL — preserva sizing determinístico em vez de zerar.
export async function refreshCapital() {
  if (config.paperTrade) {
    try {
      const { getTotalRealizedPnl } = await import("../storage/trades.js");
      const pnl = getTotalRealizedPnl();
      config.capitalUsdt = parseFloat((INITIAL_CAPITAL + pnl).toFixed(2));
    } catch {
      // Tabela `trades` ainda não criada na primeira execução → fica
      // no inicial. db.js cria o schema no primeiro `import`, mas se
      // alguém chamar `refreshCapital()` antes disso, o catch protege.
      config.capitalUsdt = INITIAL_CAPITAL;
    }
    return config.capitalUsdt;
  }

  // LIVE mode
  try {
    const { getBalance } = await import("../exchanges/bingx.js");
    const bal = await getBalance();
    if (bal.total > 0) {
      config.capitalUsdt = parseFloat(bal.total.toFixed(2));
    } else if (bal.available > 0) {
      config.capitalUsdt = parseFloat(bal.available.toFixed(2));
    }
    return config.capitalUsdt;
  } catch {
    // BingX offline ou sem keys — não derruba o scan, mantém o último
    // valor conhecido (que pode ser o inicial ou um anterior bem-sucedido).
    return config.capitalUsdt;
  }
}

// ── Validate BingX TRADE keys when live trading ──────────────
export function validateBingXKeys() {
  if (config.paperTrade) return; // skip in paper mode
  if (!config.bingx.apiKey || config.bingx.apiKey.includes("your_")) {
    throw new Error(
      "PAPER_TRADE=false but BINGX_API_KEY is not set.\n" +
        "  → See SETUP_BINGX.md for instructions."
    );
  }
  if (!config.bingx.secretKey || config.bingx.secretKey.includes("your_")) {
    throw new Error(
      "PAPER_TRADE=false but BINGX_SECRET_KEY is not set.\n" +
        "  → See SETUP_BINGX.md for instructions."
    );
  }
}

export default config;
