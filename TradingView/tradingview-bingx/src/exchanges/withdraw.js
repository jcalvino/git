// ─────────────────────────────────────────────────────────────────
//  Auto-Withdraw — USDC (Futures) → Withdraw direto para carteira BASE
//
//  Fluxo disparado quando um trade USDC-M fecha 100% com P&L > 0:
//    1. Trade USDC-M fecha com lucro em USDC na conta Perpetual
//    2. Transfere USDC da conta Perpetual → Fund/Main
//       (BingX exige Fund/Main wallet como origem de saques)
//    3. Submete withdrawal USDC para a carteira BASE configurada
//
//  Diferente da versão anterior: **não há mais swap USDT → USDC**
//  porque os trades já são liquidados em USDC (USDC-M futures).
//
//  Configurável via .env:
//    AUTO_WITHDRAW_ENABLED  — master switch (default: false)
//    WITHDRAW_DRY_RUN       — loga sem executar (default: true)
//    WITHDRAW_WALLET_ADDRESS— destino (deve estar whitelisted na BingX)
//    WITHDRAW_NETWORK       — rede (default: BASE)
//    WITHDRAW_MIN_USDC      — mínimo em USDC abaixo do qual acumula
//                              sem sacar (default: 10)
//
//  Safety:
//    - PAPER_TRADE=true        → sempre no-op
//    - AUTO_WITHDRAW_ENABLED=false → no-op
//    - WITHDRAW_DRY_RUN=true   → loga mas não executa
//    - Endereço destino DEVE estar whitelisted na BingX p/ rede BASE
//    - Usa API key DEDICADA (BINGX_WITHDRAW_API_KEY) — separada da
//      trade key — com permissão Withdraw + Internal Transfer.
//      Se não estiver setada, cai de volta para a trade key e loga
//      um aviso (para compat com setups antigos de uma key só).
// ─────────────────────────────────────────────────────────────────

import { createHmac } from "crypto";
import https from "https";
import config from "../config/index.js";

const BASE_URL = config.bingx.baseUrl;

// ── Selecionar keys: withdraw-específicas > trade key (fallback) ──
// A trade key NUNCA deveria ter Withdraw habilitado em produção,
// então em setup correto o fallback falha com "Permission denied"
// na BingX — o que é o comportamento desejado (fail-loud).
const HAS_DEDICATED_WITHDRAW_KEYS =
  !!config.bingxWithdraw?.apiKey && !!config.bingxWithdraw?.secretKey;

const API_KEY = HAS_DEDICATED_WITHDRAW_KEYS
  ? config.bingxWithdraw.apiKey
  : config.bingx.apiKey;

const SECRET = HAS_DEDICATED_WITHDRAW_KEYS
  ? config.bingxWithdraw.secretKey
  : config.bingx.secretKey;

if (!HAS_DEDICATED_WITHDRAW_KEYS && API_KEY) {
  console.warn(
    "[WITHDRAW] BINGX_WITHDRAW_API_KEY/SECRET_KEY não setadas — " +
    "usando a TRADE key como fallback. Por segurança, gere uma API " +
    "key separada com permissão Withdraw + Internal Transfer e " +
    "preencha no .env. Veja SETUP_BINGX.md."
  );
}

const AUTO_ENABLED    = (process.env.AUTO_WITHDRAW_ENABLED || "false").toLowerCase() === "true";
const DRY_RUN         = (process.env.WITHDRAW_DRY_RUN     || "true").toLowerCase() === "true";
const WALLET_ADDRESS  = process.env.WITHDRAW_WALLET_ADDRESS || "";
const NETWORK         = process.env.WITHDRAW_NETWORK || "BASE";
const MIN_USDC        = parseFloat(process.env.WITHDRAW_MIN_USDC || "10");

// ── HMAC-signed request helper ────────────────────────────────────
function _sign(params) {
  const sorted = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&");
  return createHmac("sha256", SECRET).update(sorted).digest("hex");
}

function _request(method, path, params = {}) {
  return new Promise((resolve, reject) => {
    const timestamp = Date.now().toString();
    const all = { ...params, timestamp };
    const signature = _sign(all);
    const query = Object.keys(all).sort()
      .map((k) => `${k}=${encodeURIComponent(all[k])}`).join("&") + `&signature=${signature}`;

    const isGet   = method === "GET";
    const options = {
      hostname: new URL(BASE_URL).hostname,
      path:     isGet ? `${path}?${query}` : path,
      method,
      headers: {
        "X-BX-APIKEY":  API_KEY,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.code !== 0 && parsed.code !== "0") {
            reject(new Error(`BingX ${path} error ${parsed.code}: ${parsed.msg}`));
          } else {
            resolve(parsed.data ?? parsed);
          }
        } catch {
          reject(new Error(`Invalid JSON from ${path}: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on("error", reject);
    if (!isGet) req.write(query);
    req.end();
  });
}

// ── BingX low-level operations ────────────────────────────────────

/**
 * Transfer de asset entre carteiras BingX.
 *
 * Tipos (type) relevantes neste fluxo:
 *   PFUTURES_FUND  → PERP  → FUND / Main (preparar p/ withdraw)
 *
 * @param {string} type   — código BingX, ex: "PFUTURES_FUND"
 * @param {string} asset  — "USDC"
 * @param {number} amount
 */
async function _transfer(type, asset, amount) {
  return _request("POST", "/openApi/api/v3/post/asset/transfer", {
    type,
    asset,
    amount: amount.toFixed(6),
  });
}

/**
 * Submete um saque cripto.
 *
 * @param {object} p
 * @param {string} p.coin     — "USDC"
 * @param {string} p.network  — "BASE" | "ERC20" | …
 * @param {string} p.address  — wallet destino (precisa estar whitelisted)
 * @param {number} p.amount
 */
async function _withdraw({ coin, network, address, amount }) {
  return _request("POST", "/openApi/wallets/v1/capital/withdraw/apply", {
    coin,
    network,
    address,
    amount: amount.toFixed(6),
    // walletType: 1 = FUND / Main account (padrão para saques).
    walletType: 1,
  });
}

/** Lê saldo livre USDC na conta Fund/Main (onde o withdraw é submetido). */
async function _getFundBalance(asset) {
  try {
    // BingX: GET /openApi/wallets/v1/capital/config/getall retorna config por coin.
    // Para saldo, usamos /openApi/api/v3/get/asset (user balance snapshot).
    const data = await _request("GET", "/openApi/api/v3/get/asset");
    const balances = data?.balances ?? data ?? [];
    const hit = (Array.isArray(balances) ? balances : []).find((b) => b.asset === asset);
    return {
      free:   parseFloat(hit?.free   ?? hit?.available ?? 0),
      locked: parseFloat(hit?.locked ?? 0),
    };
  } catch (err) {
    console.warn(`[WITHDRAW] Falha lendo saldo Fund ${asset}: ${err.message}`);
    return { free: 0, locked: 0 };
  }
}

// ── High-level orchestrator ───────────────────────────────────────

/**
 * Chamada após um trade USDC-M fechar 100% com lucro.
 *
 * Fluxo novo (sem swap, sem SPOT trading intermediário):
 *   1. Transferir USDC: PERP → FUND
 *   2. Withdraw USDC direto para wallet BASE
 *
 * @param {object} opts
 * @param {string} opts.symbol   — só para logs (ex: "BTCUSDC")
 * @param {number} opts.pnl_usdt — lucro líquido em USDC (>0)
 *                                 (nome do campo mantido por compat com monitor.js)
 * @returns {Promise<{ok: boolean, steps: object[], skipped?: string}>}
 */
export async function onTradeClosedWithProfit({ symbol, pnl_usdt }) {
  const steps = [];
  const log   = (msg, data) => {
    const line = `[WITHDRAW] ${msg}` + (data ? ` ${JSON.stringify(data)}` : "");
    console.log(line);
    steps.push({ msg, data });
  };

  // ── Guard rails ──────────────────────────────────────────────
  if (config.paperTrade) {
    log("PAPER_TRADE=true → skip auto-withdraw", { symbol, pnl_usdc: pnl_usdt });
    return { ok: true, skipped: "paper_trade", steps };
  }
  if (!AUTO_ENABLED) {
    log("AUTO_WITHDRAW_ENABLED=false → skip", { symbol, pnl_usdc: pnl_usdt });
    return { ok: true, skipped: "disabled", steps };
  }
  if (!pnl_usdt || pnl_usdt <= 0) {
    log("pnl <= 0 → skip", { symbol, pnl_usdc: pnl_usdt });
    return { ok: true, skipped: "no_profit", steps };
  }
  if (!WALLET_ADDRESS) {
    log("WITHDRAW_WALLET_ADDRESS vazio → skip");
    return { ok: false, skipped: "missing_wallet", steps };
  }

  const amount = parseFloat(pnl_usdt.toFixed(2));
  if (amount < MIN_USDC) {
    log(`P&L USDC (${amount}) < MIN_USDC (${MIN_USDC}) → acumula sem sacar`, { symbol });
    return { ok: true, skipped: "below_min_threshold", steps };
  }

  log("START", { symbol, pnl_usdc: amount, wallet: WALLET_ADDRESS, network: NETWORK, dryRun: DRY_RUN });

  try {
    // ── Step 1: Transfer USDC Futures → Fund ──────────────────
    log("STEP 1/2 — transfer USDC: PERP → FUND", { amount });
    if (!DRY_RUN) {
      await _transfer("PFUTURES_FUND", "USDC", amount);
    }

    // Aguarda fill e confere saldo USDC no Fund
    const fundUsdc = DRY_RUN
      ? { free: amount /* mock */, locked: 0 }
      : await _getFundBalance("USDC");

    const usdcAvailable = Math.min(fundUsdc.free, amount);
    log("Saldo USDC disponível no Fund", { free: fundUsdc.free, withdrawAmount: usdcAvailable });

    if (usdcAvailable < MIN_USDC) {
      log(`Saldo USDC (${usdcAvailable}) < MIN_USDC (${MIN_USDC}) → abort`);
      return { ok: true, skipped: "below_min_threshold_post_transfer", steps };
    }

    // ── Step 2: Withdraw USDC → BASE ──────────────────────────
    log("STEP 2/2 — withdraw USDC para BASE", {
      amount:  usdcAvailable,
      address: WALLET_ADDRESS,
      network: NETWORK,
    });
    let withdrawResult = null;
    try {
      withdrawResult = DRY_RUN
        ? { id: "dry-run-withdraw", amount: usdcAvailable, network: NETWORK }
        : await _withdraw({
            coin:    "USDC",
            network: NETWORK,
            address: WALLET_ADDRESS,
            amount:  usdcAvailable,
          });
      steps.push({ step: "WITHDRAW_USDC_TO_BASE", result: withdrawResult });
      log("Withdraw submetido com sucesso", withdrawResult);
    } catch (err) {
      log("Withdraw FALHOU", { error: err.message });
      return { ok: false, error: err.message, steps };
    }

    return { ok: true, steps, withdrawResult };
  } catch (err) {
    log("onTradeClosedWithProfit FALHOU", { error: err.message });
    return { ok: false, error: err.message, steps };
  }
}
