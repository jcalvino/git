// ─────────────────────────────────────────────────────────────────
//  BingX Coin-M Perpetual Futures — Hedge Module
//  Pair: BTC-USD (collateral = BTC, P&L settled in BTC)
//
//  PURPOSE: Proteção (hedge) contra quedas do BTC.
//  ─────────────────────────────────────────────────────────────────
//  Coin-M SHORT é um hedge clássico de portfólio:
//
//  Cenário: você tem 0.0108 BTC (~$810 a $75k)
//  Se BTC cai 10% → seu BTC vale $81 menos
//  Com Coin-M SHORT 1x: o trade ganha em termos USD (mesmo que o
//  P&L seja liquidado em BTC, o número de BTC recebidos sobe)
//  → o hedge compensa parcialmente a perda do portfólio
//
//  REGRAS FIXAS (não configuráveis individualmente):
//  ──────────────────────────────────────────────────
//  • Sempre SHORT — nunca LONG (hedge de proteção apenas)
//  • Alavancagem 1x (sem multiplicador de risco)
//  • Perda máxima por trade: 1% do capital BTC alocado
//  • Capital: COINM_CAPITAL_BTC (padrão: 0.0108 BTC)
//
//  Para ativar: COINM_ENABLED=true em .env
// ─────────────────────────────────────────────────────────────────

import { createHmac } from "crypto";
import https from "https";
import config from "../config/index.js";

const BASE_HOST = new URL(config.bingx.baseUrl).hostname;
const API_KEY   = config.bingx.apiKey;
const SECRET    = config.bingx.secretKey;

// ── Configuração do Hedge ──────────────────────────────────────
export const COINM = {
  ENABLED:         () => process.env.COINM_ENABLED === "true",
  CAPITAL_BTC:     () => parseFloat(process.env.COINM_CAPITAL_BTC ?? "0.0108"),
  LEVERAGE:        1,      // sempre 1x — hedge sem amplificação de risco
  DIRECTION:       "SHORT", // sempre SHORT — hedge de proteção contra quedas
  MAX_RISK_PCT:    0.01,   // 1% máximo de perda por trade sobre o capital BTC
  SL_PCT:          0.01,   // SL a 1% do entry (define o risco máximo)
  // TP: 2:1 R/R (2% de ganho para 1% de risco)
  TP_R:            { tp1: 2.0, tp2: 3.5, tp3: 5.0 },
  SYMBOL:          "BTC-USD",
};

export function isCoinMEnabled() { return COINM.ENABLED(); }

// ── HTTP ───────────────────────────────────────────────────────

function sign(params) {
  const sorted = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&");
  return createHmac("sha256", SECRET).update(sorted).digest("hex");
}

function request(method, path, params = {}) {
  return new Promise((resolve, reject) => {
    const ts  = Date.now().toString();
    const all = { ...params, timestamp: ts };
    const sig = sign(all);
    const qs  = Object.keys(all).sort().map((k) => `${k}=${encodeURIComponent(all[k])}`).join("&") + `&signature=${sig}`;
    const isGet = method === "GET";
    const opts  = {
      hostname: BASE_HOST,
      path:     isGet ? `${path}?${qs}` : path,
      method,
      headers:  { "X-BX-APIKEY": API_KEY, "Content-Type": "application/x-www-form-urlencoded" },
    };
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.code !== 0 && parsed.code !== "0") {
            reject(new Error(`Coin-M API error ${parsed.code}: ${parsed.msg}`));
          } else {
            resolve(parsed.data ?? parsed);
          }
        } catch { reject(new Error(`Invalid JSON: ${data.slice(0, 200)}`)); }
      });
    });
    req.on("error", reject);
    if (!isGet) req.write(qs);
    req.end();
  });
}

function requestPublic(path) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: BASE_HOST, path, method: "GET", headers: { "Content-Type": "application/json" } };
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve(JSON.parse(data)?.data ?? JSON.parse(data)); }
        catch { reject(new Error(`Invalid JSON: ${data.slice(0, 200)}`)); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

// ── Public ─────────────────────────────────────────────────────

export async function getCoinMPrice() {
  // Coin-M v1: market/ticker — returns { lastPrice, ... }
  const data = await requestPublic("/openApi/cswap/v1/market/ticker?symbol=BTC-USD");
  // data may be an array or a single object depending on whether symbol is specified
  const item = Array.isArray(data) ? data[0] : data;
  return parseFloat(item?.lastPrice ?? item?.price ?? 0);
}

export async function getCoinMFundingRate() {
  // Coin-M v1: market/premiumIndex — returns { lastFundingRate, markPrice, nextFundingTime, ... }
  const data = await requestPublic("/openApi/cswap/v1/market/premiumIndex?symbol=BTC-USD");
  const item = Array.isArray(data) ? data[0] : data;
  return {
    fundingRate:     parseFloat(item?.lastFundingRate ?? item?.fundingRate ?? 0),
    nextFundingTime: item?.nextFundingTime,
  };
}

// ── Authenticated ──────────────────────────────────────────────

/**
 * Saldo da conta Coin-M (em BTC).
 * Converte para USDT usando o preço atual para exibição no dashboard.
 */
export async function getCoinMBalance() {
  const data    = await request("GET", "/openApi/cswap/v1/user/balance");
  const btcEntry = Array.isArray(data)
    ? data.find((a) => a.asset === "BTC") ?? data[0]
    : data?.balance ?? data;

  const btcBalance = parseFloat(btcEntry?.balance ?? btcEntry?.total ?? 0);
  const btcAvail   = parseFloat(btcEntry?.availableMargin ?? btcEntry?.available ?? 0);

  let btcPrice = 0;
  try { btcPrice = await getCoinMPrice(); } catch { /* ignore */ }

  return {
    asset:          "BTC",
    btcBalance,
    btcAvailable:   btcAvail,
    usdtEquivalent: parseFloat((btcBalance * btcPrice).toFixed(2)),
    configuredCapital: COINM.CAPITAL_BTC(),
    btcPrice,
  };
}

/** Posições Coin-M abertas */
export async function getCoinMPositions() {
  const data = await request("GET", "/openApi/cswap/v1/user/positions", {});
  return (Array.isArray(data) ? data : [])
    .filter((p) => parseFloat(p.positionAmt ?? 0) !== 0)
    .map((p) => {
      const markPrice = parseFloat(p.markPrice ?? 0);
      const pnlBtc    = parseFloat(p.unrealizedProfit ?? 0);
      const amt       = parseFloat(p.positionAmt ?? 0);

      // ── Direction ─────────────────────────────────────────────
      // BingX Hedge mode: positionAmt is ALWAYS positive; direction is
      // given by the explicit positionSide field ("LONG" | "SHORT").
      // One-way mode: positive amt = LONG, negative = SHORT.
      // Prefer positionSide when present.
      const side =
        p.positionSide === "SHORT" ? "SHORT" :
        p.positionSide === "LONG"  ? "LONG"  :
        amt > 0 ? "LONG" : "SHORT";

      // ── Entry price ───────────────────────────────────────────
      // Coin-M v1 uses different field names across account modes.
      // Try each candidate; skip if the value parses to 0 or NaN.
      const entryPrice = [
        p.entryPrice, p.avgCost, p.openPrice, p.avgOpenPrice,
        p.avgEntryPrice, p.avgPrice, p.positionCost,
      ]
        .map((v) => parseFloat(v ?? 0))
        .find((n) => !isNaN(n) && n > 0) ?? 0;

      return {
        symbol:        "BTC-USD",
        market:        "COIN-M",
        side,
        size:          Math.abs(amt),
        entryPrice,
        markPrice,
        // P&L settled in BTC — convert to USD for consistent dashboard display
        unrealizedPnl: markPrice > 0 ? parseFloat((pnlBtc * markPrice).toFixed(2)) : 0,
        leverage:      parseInt(p.leverage ?? 1),
      };
    });
}

/** All open Coin-M orders (pending SL/TP/limit orders) */
export async function getCoinMOpenOrders() {
  const data = await request("GET", "/openApi/cswap/v1/trade/openOrders", {});
  return Array.isArray(data) ? data : (data?.orders ?? []);
}

/**
 * Calcula o número de contratos para o hedge.
 *
 * Regras:
 * - Max loss = 1% do capital BTC configurado
 * - 1 contrato BTC-USD = $100 USD de face value
 * - Sem alavancagem (1x)
 * - Sempre SHORT
 *
 * @param {number} entryPrice — preço BTC em USD
 * @returns {{ contracts, btcAtRisk, faceValue, usdtEquivalent, btcPerContract }}
 */
export function calcCoinMHedgeSize(entryPrice) {
  const capitalBtc    = COINM.CAPITAL_BTC();
  const maxRiskBtc    = capitalBtc * COINM.MAX_RISK_PCT;  // 1% do capital BTC
  const contractFace  = 100;                               // $100 por contrato
  const btcPerContract = contractFace / entryPrice;        // BTC por contrato
  // Com 1x, a perda por contrato em BTC quando SL bate (1% do preço):
  const btcLossPerContract = btcPerContract * COINM.SL_PCT;

  const contracts = Math.max(1, Math.floor(maxRiskBtc / btcLossPerContract));
  const faceValue = contracts * contractFace;

  return {
    contracts,
    btcAtRisk:       parseFloat((contracts * btcLossPerContract).toFixed(8)),
    maxRiskBtc:      parseFloat(maxRiskBtc.toFixed(8)),
    faceValue,
    usdtEquivalent:  faceValue,                           // $100 per contract = USDT equivalent
    btcPerContract:  parseFloat(btcPerContract.toFixed(8)),
    capitalBtc,
    // Sanity check: risk vs capital
    riskPct:         parseFloat(((contracts * btcLossPerContract / capitalBtc) * 100).toFixed(2)),
  };
}

/**
 * Abre um SHORT no Coin-M BTC-USD para hedge.
 *
 * BLOQUEIOS de segurança:
 * 1. COINM_ENABLED deve ser true
 * 2. Só SHORT é permitido (direção LONG é rejeitada)
 * 3. Leverage é forçado para 1x antes de qualquer ordem
 * 4. O tamanho é calculado pelo limite de 1% de perda máxima
 *
 * @param {number} entryPrice — preço BTC atual
 * @returns {object} resultado da ordem
 */
export async function openCoinMHedge(entryPrice) {
  if (!COINM.ENABLED()) {
    throw new Error("Coin-M desabilitado. Defina COINM_ENABLED=true no .env para ativar o hedge.");
  }

  const sizing = calcCoinMHedgeSize(entryPrice);

  if (config.paperTrade) {
    console.log(
      `[PAPER Coin-M HEDGE] SHORT ${sizing.contracts} contrato(s) BTC-USD @ ~$${entryPrice.toFixed(0)}`
    );
    console.log(`  Capital BTC: ${sizing.capitalBtc} | Risco: ${sizing.btcAtRisk} BTC (${sizing.riskPct}%)`);
    console.log(`  Face value: $${sizing.faceValue} | Leverage: ${COINM.LEVERAGE}x`);
    return {
      orderId:   `PAPER_CM_${Date.now()}`,
      symbol:    "BTC-USD",
      market:    "COIN-M",
      direction: "SHORT",
      contracts: sizing.contracts,
      leverage:  COINM.LEVERAGE,
      sizing,
      paper:     true,
    };
  }

  // 1. Forçar leverage 1x antes da ordem
  await setCoinMLeverage(COINM.LEVERAGE, "SHORT");

  // 2. Colocar ordem SHORT
  const raw = await request("POST", "/openApi/cswap/v1/trade/order", {
    symbol:       "BTC-USD",
    side:         "SELL",         // SHORT = SELL no Coin-M
    positionSide: "SHORT",
    type:         "MARKET",
    quantity:     sizing.contracts.toString(),
  });

  const order = raw?.order ?? raw;
  return {
    orderId:   order.orderId ?? null,
    symbol:    "BTC-USD",
    market:    "COIN-M",
    direction: "SHORT",
    contracts: sizing.contracts,
    leverage:  COINM.LEVERAGE,
    price:     parseFloat(order.avgPrice ?? order.price ?? entryPrice),
    sizing,
    paper:     false,
  };
}

/**
 * Fecha o hedge Coin-M (buy to close SHORT).
 * Chamado quando o setup bearish é invalidado ou TP é atingido.
 */
export async function closeCoinMHedge(contracts) {
  if (!COINM.ENABLED()) throw new Error("Coin-M desabilitado.");

  if (config.paperTrade) {
    console.log(`[PAPER Coin-M HEDGE] Fechando SHORT ${contracts} contrato(s) BTC-USD`);
    return { closed: true, contracts, paper: true };
  }

  return request("POST", "/openApi/cswap/v1/trade/order", {
    symbol:       "BTC-USD",
    side:         "BUY",          // fechar SHORT = BUY
    positionSide: "SHORT",
    type:         "MARKET",
    quantity:     contracts.toString(),
  });
}

export async function setCoinMLeverage(leverage = 1, side = "SHORT") {
  if (config.paperTrade) return { symbol: "BTC-USD", leverage };
  return request("POST", "/openApi/cswap/v1/trade/leverage", {
    symbol: "BTC-USD",
    side,
    leverage,
  });
}
