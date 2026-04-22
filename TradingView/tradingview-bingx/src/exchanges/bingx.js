// ─────────────────────────────────────────────────────────────────
//  BingX USDT-M Perpetual Futures API Client
//  REST + WebSocket for BTC/ETH trading
// ─────────────────────────────────────────────────────────────────

import { createHmac } from "crypto";
import https from "https";
import { fileURLToPath } from "url";
import config from "../config/index.js";

const BASE = config.bingx.baseUrl;
const API_KEY = config.bingx.apiKey;
const SECRET = config.bingx.secretKey;

// ── Signature ──────────────────────────────────────────────────
function sign(params) {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return createHmac("sha256", SECRET).update(sorted).digest("hex");
}

// ── HTTP Request ───────────────────────────────────────────────
function request(method, path, params = {}) {
  return new Promise((resolve, reject) => {
    const timestamp = Date.now().toString();
    const allParams = { ...params, timestamp };
    const signature = sign(allParams);

    const queryStr =
      Object.keys(allParams)
        .sort()
        .map((k) => `${k}=${encodeURIComponent(allParams[k])}`)
        .join("&") + `&signature=${signature}`;

    const isGet = method === "GET";
    const fullPath = isGet ? `${path}?${queryStr}` : path;
    const bodyStr = isGet ? null : queryStr;

    const options = {
      hostname: new URL(BASE).hostname,
      path: fullPath,
      method,
      headers: {
        "X-BX-APIKEY": API_KEY,
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
            reject(new Error(`BingX API error ${parsed.code}: ${parsed.msg}`));
          } else {
            resolve(parsed.data ?? parsed);
          }
        } catch {
          reject(new Error(`Invalid JSON response: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Public Endpoints (no auth needed) ─────────────────────────

/** Get current mark price for a symbol */
export async function getPrice(symbol) {
  const data = await requestPublic(
    "GET",
    `/openApi/swap/v2/quote/price?symbol=${symbol}`
  );
  return parseFloat(data.price ?? data[0]?.price ?? 0);
}

/** Get order book depth */
export async function getOrderBook(symbol, limit = 20) {
  const data = await requestPublic(
    "GET",
    `/openApi/swap/v2/quote/depth?symbol=${symbol}&limit=${limit}`
  );
  return {
    bids: (data.bids ?? []).map(([price, qty]) => ({
      price: parseFloat(price),
      qty: parseFloat(qty),
    })),
    asks: (data.asks ?? []).map(([price, qty]) => ({
      price: parseFloat(price),
      qty: parseFloat(qty),
    })),
  };
}

/** Get klines (OHLCV) */
export async function getKlines(symbol, interval = "1h", limit = 100) {
  const data = await requestPublic(
    "GET",
    `/openApi/swap/v2/quote/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
  );
  return (data ?? []).map((k) => ({
    openTime: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

/** Get funding rate */
export async function getFundingRate(symbol) {
  const data = await requestPublic(
    "GET",
    `/openApi/swap/v2/quote/fundingRate?symbol=${symbol}`
  );
  return {
    symbol: data.symbol,
    fundingRate: parseFloat(data.fundingRate ?? 0),
    nextFundingTime: data.nextFundingTime,
  };
}

/** Get open interest */
export async function getOpenInterest(symbol) {
  const data = await requestPublic(
    "GET",
    `/openApi/swap/v2/quote/openInterest?symbol=${symbol}`
  );
  return {
    symbol: data.symbol,
    openInterest: parseFloat(data.openInterest ?? 0),
    openInterestValue: parseFloat(data.openInterestValue ?? 0),
  };
}

// Public request (no auth)
function requestPublic(method, fullPath) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: new URL(BASE).hostname,
      path: fullPath,
      method,
      headers: { "Content-Type": "application/json" },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.data ?? parsed);
        } catch {
          reject(new Error(`Invalid JSON: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

// ── Authenticated Endpoints ────────────────────────────────────

/** Get futures account balance */
export async function getBalance() {
  const data = await request("GET", "/openApi/swap/v2/user/balance");

  // BingX returns one of:
  //   { balance: { asset, balance, availableMargin, ... } }  ← single object
  //   { balance: [{ asset, ... }] }                          ← array (older API)
  //   [{ asset, ... }]                                       ← bare array
  let usdt;
  if (Array.isArray(data)) {
    usdt = data.find((a) => a.asset === "USDT") ?? data[0];
  } else if (Array.isArray(data?.balance)) {
    usdt = data.balance.find((a) => a.asset === "USDT") ?? data.balance[0];
  } else if (data?.balance) {
    usdt = data.balance; // single object — most common response
  } else {
    usdt = data;
  }

  return {
    available: parseFloat(usdt?.availableMargin ?? usdt?.available ?? 0),
    total: parseFloat(usdt?.balance ?? usdt?.equity ?? usdt?.total ?? 0),
    unrealizedPnl: parseFloat(usdt?.unrealizedProfit ?? 0),
  };
}

/** Get open positions */
export async function getPositions(symbol = null) {
  const params = symbol ? { symbol } : {};
  const data = await request("GET", "/openApi/swap/v2/user/positions", params);
  return (Array.isArray(data) ? data : [])
    .filter((p) => parseFloat(p.positionAmt ?? 0) !== 0)
    .map((p) => {
      const amt = parseFloat(p.positionAmt ?? 0);
      // Hedge mode: positionAmt is always positive for both LONG and SHORT.
      // Direction is in positionSide field. Fall back to sign of amt for one-way mode.
      const side =
        p.positionSide === "SHORT" ? "SHORT" :
        p.positionSide === "LONG"  ? "LONG"  :
        amt > 0 ? "LONG" : "SHORT";
      // Try multiple field names — BingX field name varies by account mode/version
      const entryPrice = [p.entryPrice, p.avgPrice, p.avgCostPrice, p.openPrice, p.avgCost]
        .map((v) => parseFloat(v ?? 0))
        .find((n) => !isNaN(n) && n > 0) ?? 0;

      return {
        symbol: p.symbol,
        side,
        size: Math.abs(amt),
        entryPrice,
        markPrice: parseFloat(p.markPrice ?? 0),
        unrealizedPnl: parseFloat(p.unrealizedProfit ?? 0),
        leverage: parseInt(p.leverage ?? 1),
      };
    });
}

/** Get all open orders (pending SL/TP/limit orders) */
export async function getOpenOrders(symbol = null) {
  const params = symbol ? { symbol } : {};
  const data = await request("GET", "/openApi/swap/v2/trade/openOrders", params);
  // Response may be { orders: [...] } or a bare array
  return Array.isArray(data) ? data : (data?.orders ?? []);
}

/** Place a market order */
export async function placeOrder({
  symbol,
  side,        // "BUY" | "SELL"
  positionSide, // "LONG" | "SHORT"
  quantity,
  reduceOnly = false,
}) {
  if (config.paperTrade) {
    const price = await getPrice(symbol);
    console.log(
      `[PAPER] ${side} ${quantity} ${symbol} @ ~$${price.toFixed(2)} ` +
        `(${positionSide}${reduceOnly ? " reduce-only" : ""})`
    );
    return {
      orderId: `PAPER_${Date.now()}`,
      symbol,
      side,
      positionSide,
      quantity,
      price,
      paper: true,
    };
  }

  const params = {
    symbol,
    side,
    positionSide,
    type: "MARKET",
    quantity: quantity.toFixed(4),
  };
  // In Hedge mode, sending reduceOnly=false causes error 109400.
  // Only include the field when actually closing a position.
  if (reduceOnly) params.reduceOnly = "true";

  const raw = await request("POST", "/openApi/swap/v2/trade/order", params);

  // BingX wraps the order in { order: {...} }
  const order = raw?.order ?? raw;
  return {
    orderId: order.orderId ?? order.clientOrderId ?? null,
    symbol: order.symbol ?? symbol,
    side: order.side ?? side,
    positionSide: order.positionSide ?? positionSide,
    price: parseFloat(order.avgPrice ?? order.price ?? 0),
    quantity: parseFloat(order.origQty ?? order.quantity ?? quantity),
    paper: false,
  };
}

/**
 * Place a LIMIT order (GTC — Good Till Cancelled).
 * Used for scale-in entries: price is guaranteed, fills when market reaches it.
 */
export async function placeLimitOrder({
  symbol,
  side,          // "BUY" | "SELL"
  positionSide,  // "LONG" | "SHORT"
  quantity,
  price,
  timeInForce = "GTC",
}) {
  if (config.paperTrade) {
    console.log(
      `[PAPER LIMIT] ${side} ${quantity} ${symbol} @ $${price.toFixed(2)} (${positionSide}, ${timeInForce})`
    );
    return {
      orderId:      `PAPER_LMT_${Date.now()}`,
      symbol,
      side,
      positionSide,
      price,
      quantity,
      paper: true,
    };
  }

  const raw = await request("POST", "/openApi/swap/v2/trade/order", {
    symbol,
    side,
    positionSide,
    type:        "LIMIT",
    quantity:    quantity.toFixed(4),
    price:       price.toFixed(2),
    timeInForce,
  });

  const order = raw?.order ?? raw;
  return {
    orderId:      order.orderId ?? null,
    symbol:       order.symbol ?? symbol,
    side:         order.side ?? side,
    positionSide: order.positionSide ?? positionSide,
    price:        parseFloat(order.price ?? price),
    quantity:     parseFloat(order.origQty ?? order.quantity ?? quantity),
    paper: false,
  };
}

/** Set leverage for a symbol and side */
export async function setLeverage(symbol, leverage = 1, side = "LONG") {
  if (config.paperTrade) return { symbol, leverage };
  return request("POST", "/openApi/swap/v2/trade/leverage", {
    symbol,
    side,
    leverage,
  });
}

/**
 * Format a price to appropriate decimal precision based on its magnitude.
 * BingX rejects prices with too many or too few decimals.
 */
function _fmtPrice(price) {
  if (price >= 10000)  return price.toFixed(1);
  if (price >= 1000)   return price.toFixed(2);
  if (price >= 100)    return price.toFixed(2);
  if (price >= 10)     return price.toFixed(3);
  if (price >= 1)      return price.toFixed(4);
  if (price >= 0.1)    return price.toFixed(5);
  return price.toFixed(6);
}

/**
 * Fetch the current mark price for a symbol from BingX.
 * Used to validate SL/TP sides before placement.
 */
async function _getMarkPrice(symbol) {
  try {
    const data = await request("GET", "/openApi/swap/v2/quote/price", { symbol });
    return parseFloat(data?.price ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Place SL and TP bracket orders after an entry is filled.
 * Uses STOP_MARKET (SL) and TAKE_PROFIT_MARKET (TP1/2/3).
 *
 * Safety guards:
 *  1. Fetches current mark price and validates SL is on the correct side.
 *     If price moved against us, adjusts SL by a small buffer (0.1%) to
 *     ensure BingX accepts it — then logs a warning.
 *  2. Validates TP prices are on the correct side.
 *  3. Uses _fmtPrice() for correct decimal precision per asset.
 */
export async function placeSlTpOrders({
  symbol,
  direction,
  size,
  slPrice,
  tp1Price,
  tp2Price,
  tp3Price,
}) {
  if (config.paperTrade) {
    console.log(
      `[PAPER] SL@${slPrice} | TP1@${tp1Price} | TP2@${tp2Price} | TP3@${tp3Price}`
    );
    return {
      sl: { paper: true },
      tp1: { paper: true },
      tp2: { paper: true },
      tp3: { paper: true },
    };
  }

  const isLong    = direction === "LONG";
  const closeSide = isLong ? "SELL" : "BUY";

  // ── Fetch current mark price and validate/adjust SL ───────────
  const markPrice = await _getMarkPrice(symbol);
  let safeSl = slPrice;

  if (markPrice > 0) {
    // LONG SL must be BELOW mark price; SHORT SL must be ABOVE mark price
    const slOnWrongSide = isLong
      ? safeSl >= markPrice          // SL at or above current price for LONG
      : safeSl <= markPrice;         // SL at or below current price for SHORT

    if (slOnWrongSide) {
      // Price moved past our SL — adjust to 0.2% beyond current price
      const adjusted = isLong
        ? markPrice * 0.998           // LONG: 0.2% below mark
        : markPrice * 1.002;          // SHORT: 0.2% above mark
      console.warn(
        `[BINGX] SL side mismatch for ${direction} ${symbol}: ` +
        `SL $${safeSl} vs mark $${markPrice} — adjusting SL to $${adjusted.toFixed(4)}`
      );
      safeSl = adjusted;
    }
  }

  // ── Size distribution ─────────────────────────────────────────
  const tp1Size = parseFloat((size * 0.4).toFixed(4));
  const tp2Size = parseFloat((size * 0.35).toFixed(4));
  const tp3Size = parseFloat((size - tp1Size - tp2Size).toFixed(4));

  const [sl, tp1, tp2, tp3] = await Promise.allSettled([
    request("POST", "/openApi/swap/v2/trade/order", {
      symbol,
      side: closeSide,
      positionSide: direction,
      type: "STOP_MARKET",
      quantity: size.toFixed(4),
      stopPrice: _fmtPrice(safeSl),
      workingType: "MARK_PRICE",
    }),
    request("POST", "/openApi/swap/v2/trade/order", {
      symbol,
      side: closeSide,
      positionSide: direction,
      type: "TAKE_PROFIT_MARKET",
      quantity: tp1Size.toFixed(4),
      stopPrice: _fmtPrice(tp1Price),
      workingType: "MARK_PRICE",
    }),
    request("POST", "/openApi/swap/v2/trade/order", {
      symbol,
      side: closeSide,
      positionSide: direction,
      type: "TAKE_PROFIT_MARKET",
      quantity: tp2Size.toFixed(4),
      stopPrice: _fmtPrice(tp2Price),
      workingType: "MARK_PRICE",
    }),
    request("POST", "/openApi/swap/v2/trade/order", {
      symbol,
      side: closeSide,
      positionSide: direction,
      type: "TAKE_PROFIT_MARKET",
      quantity: tp3Size.toFixed(4),
      stopPrice: _fmtPrice(tp3Price),
      workingType: "MARK_PRICE",
    }),
  ]);

  const unwrap = (r) =>
    r.status === "fulfilled"
      ? { orderId: r.value?.order?.orderId ?? r.value?.orderId ?? null }
      : { error: r.reason?.message };

  return {
    sl:  unwrap(sl),
    tp1: unwrap(tp1),
    tp2: unwrap(tp2),
    tp3: unwrap(tp3),
  };
}

/** Cancel an open order */
export async function cancelOrder(symbol, orderId) {
  if (config.paperTrade) return { orderId, cancelled: true, paper: true };
  return request("DELETE", "/openApi/swap/v2/trade/order", {
    symbol,
    orderId,
  });
}

/** Get order history */
export async function getOrderHistory(symbol, limit = 50) {
  const data = await request("GET", "/openApi/swap/v2/trade/allOrders", {
    symbol,
    limit,
  });
  return Array.isArray(data) ? data : [];
}

// ── Self-test ──────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log("Testing BingX connection...\n");

  const results = await Promise.allSettled([
    getPrice("BTC-USDT"),
    getPrice("ETH-USDT"),
    getFundingRate("BTC-USDT"),
    getOpenInterest("BTC-USDT"),
    getOrderBook("BTC-USDT", 5),
  ]);

  const [btcPrice, ethPrice, funding, oi, book] = results;

  console.log(
    `BTC price: $${btcPrice.status === "fulfilled" ? btcPrice.value.toFixed(2) : "ERROR: " + btcPrice.reason?.message}`
  );
  console.log(
    `ETH price: $${ethPrice.status === "fulfilled" ? ethPrice.value.toFixed(2) : "ERROR: " + ethPrice.reason?.message}`
  );
  console.log(
    `BTC funding rate: ${funding.status === "fulfilled" ? (funding.value.fundingRate * 100).toFixed(4) + "%" : "ERROR: " + funding.reason?.message}`
  );
  console.log(
    `BTC open interest: ${oi.status === "fulfilled" ? oi.value.openInterest.toLocaleString() + " BTC" : "ERROR: " + oi.reason?.message}`
  );

  if (book.status === "fulfilled") {
    const b = book.value;
    const topBid = b.bids[0];
    const topAsk = b.asks[0];
    console.log(
      `BTC order book — Best bid: $${topBid?.price.toFixed(2)} | Best ask: $${topAsk?.price.toFixed(2)}`
    );
  }

  if (config.bingx.apiKey && !config.bingx.apiKey.includes("your_")) {
    try {
      const bal = await getBalance();
      console.log(`\n✅ BingX connection OK`);
      console.log(`   Available: $${bal.available.toFixed(2)} USDT`);
      console.log(`   Total: $${bal.total.toFixed(2)} USDT`);
      console.log(`   Unrealized P&L: $${bal.unrealizedPnl.toFixed(2)}`);
    } catch (err) {
      console.log(`\n❌ Auth failed: ${err.message}`);
    }
  } else {
    console.log(
      "\n⚠  API key not configured — auth endpoints skipped (paper trade mode)"
    );
  }
}
