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

// ── Config Export ──────────────────────────────────────────────
export const config = {
  // Trading mode
  paperTrade: bool("PAPER_TRADE", true),

  // Capital — projeto opera em USDC-M futures.
  // Aceita CAPITAL_USDC (preferido) ou CAPITAL_USDT (legacy) como fallback.
  // Nome do campo `capitalUsdt` mantido para não quebrar consumers.
  capitalUsdt: num("CAPITAL_USDC", num("CAPITAL_USDT", 200)),
  maxRiskPct: num("MAX_RISK_PCT", 0.01),
  minScore: num("MIN_SCORE", 65),

  // BingX — TRADE key (Futures Read + Futures Trade only).
  // Requerida quando PAPER_TRADE=false.
  bingx: {
    apiKey: optional("BINGX_API_KEY", ""),
    secretKey: optional("BINGX_SECRET_KEY", ""),
    baseUrl: optional("BINGX_BASE_URL", "https://open-api.bingx.com"),
  },

  // BingX — WITHDRAW key (Withdraw + Internal Transfer only).
  // Separada da trade key por princípio de menor privilégio:
  // se a trade key vazar, o atacante não consegue sacar.
  // Só é obrigatória quando AUTO_WITHDRAW_ENABLED=true e WITHDRAW_DRY_RUN=false.
  bingxWithdraw: {
    apiKey: optional("BINGX_WITHDRAW_API_KEY", ""),
    secretKey: optional("BINGX_WITHDRAW_SECRET_KEY", ""),
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
// Call before each scan or before position sizing to ensure we use
// the real balance, not the static config value.
// Falls back silently to config value in paper mode or if API is down.
export async function refreshCapital() {
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
    // Paper mode or no API keys configured — keep static value
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

// ── Validate BingX WITHDRAW keys when auto-withdraw is live ──
// Só cobra a presença das keys quando AUTO_WITHDRAW_ENABLED=true
// e WITHDRAW_DRY_RUN=false — ou seja, quando o código vai de fato
// chamar a BingX para transferir e sacar.
export function validateBingXWithdrawKeys() {
  const autoEnabled = (process.env.AUTO_WITHDRAW_ENABLED || "false").toLowerCase() === "true";
  const dryRun      = (process.env.WITHDRAW_DRY_RUN      || "true").toLowerCase()  === "true";
  if (!autoEnabled || dryRun) return; // fluxo inerte ou dry-run → skip

  if (!config.bingxWithdraw.apiKey || config.bingxWithdraw.apiKey.includes("your_")) {
    throw new Error(
      "AUTO_WITHDRAW_ENABLED=true but BINGX_WITHDRAW_API_KEY is not set.\n" +
        "  → Set it in .env (separate from trade key; needs Withdraw + Internal Transfer perms)."
    );
  }
  if (!config.bingxWithdraw.secretKey || config.bingxWithdraw.secretKey.includes("your_")) {
    throw new Error(
      "AUTO_WITHDRAW_ENABLED=true but BINGX_WITHDRAW_SECRET_KEY is not set."
    );
  }
  if (!process.env.WITHDRAW_WALLET_ADDRESS) {
    throw new Error("AUTO_WITHDRAW_ENABLED=true but WITHDRAW_WALLET_ADDRESS is empty.");
  }
}

export default config;
