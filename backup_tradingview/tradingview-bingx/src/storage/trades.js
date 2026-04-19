// ─────────────────────────────────────────────────────────────────
//  Trade Storage Layer
//  CRUD operations for signals, trades, positions, and snapshots.
// ─────────────────────────────────────────────────────────────────

import db from "./db.js";

// ── Signals ────────────────────────────────────────────────────

export function saveSignal(signal) {
  const result = db.prepare(`
    INSERT INTO signals (
      symbol, direction, score, trade_type, price, entry, sl, tp1, tp2, tp3,
      position_size, position_value, risk_dollars,
      setup_id, setup_name, rationale, leverage,
      scale_entries, avg_entry,
      breakdown, inputs, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    signal.symbol,
    signal.direction,
    signal.score,
    signal.tradeType ?? "SWING",
    signal.price,
    signal.entry,
    signal.sl,
    signal.tp1,
    signal.tp2,
    signal.tp3,
    signal.sizing?.positionSize ?? 0,
    signal.sizing?.positionValue ?? 0,
    signal.sizing?.riskDollars ?? 0,
    signal.setup_id    ?? null,
    signal.setup_name  ?? null,
    JSON.stringify(signal.rationale     ?? []),
    signal.leverage    ?? 1,
    JSON.stringify(signal.scaleEntries  ?? []),
    signal.avgEntry    ?? signal.entry,
    JSON.stringify(signal.breakdown     ?? {}),
    JSON.stringify(signal.inputs        ?? {}),
    signal.status ?? "PENDING_APPROVAL",
    signal.createdAt ?? new Date().toISOString(),
  );

  return result.lastInsertRowid;
}

export function getPendingSignals() {
  return db
    .prepare(`
      SELECT * FROM signals
      WHERE status = 'PENDING_APPROVAL'
      ORDER BY score DESC, created_at DESC
    `)
    .all()
    .map(parseSignalRow);
}

export function getSignal(id) {
  return parseSignalRow(
    db.prepare("SELECT * FROM signals WHERE id = ?").get(id)
  );
}

export function updateSignalStatus(id, status) {
  db.prepare(
    "UPDATE signals SET status = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(status, id);
}

export function getRecentSignals(limit = 20) {
  return db
    .prepare(`SELECT * FROM signals ORDER BY created_at DESC LIMIT ?`)
    .all(limit)
    .map(parseSignalRow);
}

// ── Trades ─────────────────────────────────────────────────────

export function openTrade(signalId, orderResult) {
  const signal = getSignal(signalId);
  if (!signal) throw new Error(`Signal ${signalId} not found`);

  const tradeId = db.prepare(`
    INSERT INTO trades (
      signal_id, symbol, direction, trade_type,
      entry_price, size, sl_price, tp1_price, tp2_price, tp3_price,
      status, bingx_order_id, paper_trade, opened_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, datetime('now'))
  `).run(
    signalId,
    signal.symbol,
    signal.direction,
    signal.trade_type ?? "SWING",
    orderResult.price ?? signal.entry,
    signal.position_size,
    signal.sl,
    signal.tp1,
    signal.tp2,
    signal.tp3,
    orderResult.orderId ?? null,
    orderResult.paper ? 1 : 0,
  ).lastInsertRowid;

  // Update signal status
  updateSignalStatus(signalId, "APPROVED");

  // Create position record
  db.prepare(`
    INSERT INTO positions (
      trade_id, symbol, side, size, entry_price,
      sl_price, tp1_price, tp2_price, tp3_price
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    tradeId,
    signal.symbol,
    signal.direction,
    signal.position_size,
    orderResult.price ?? signal.entry,
    signal.sl,
    signal.tp1,
    signal.tp2,
    signal.tp3
  );

  return tradeId;
}

export function closeTrade(tradeId, exitPrice, closeReason) {
  const trade = getTrade(tradeId);
  if (!trade) throw new Error(`Trade ${tradeId} not found`);

  const direction = trade.direction === "LONG" ? 1 : -1;
  const pnl = (exitPrice - trade.entry_price) * trade.size * direction;
  const pnlPct = (pnl / (trade.entry_price * trade.size)) * 100;

  db.prepare(`
    UPDATE trades SET
      exit_price = ?, pnl = ?, pnl_pct = ?,
      status = 'CLOSED', close_reason = ?,
      closed_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).run(exitPrice, pnl, pnlPct, closeReason, tradeId);

  db.prepare(
    "DELETE FROM positions WHERE trade_id = ?"
  ).run(tradeId);

  return { tradeId, pnl, pnlPct };
}

export function recordPartialClose(tradeId, closeType, price, size) {
  const trade = getTrade(tradeId);
  if (!trade) throw new Error(`Trade ${tradeId} not found`);

  const direction = trade.direction === "LONG" ? 1 : -1;
  const pnl = (price - trade.entry_price) * size * direction;

  db.prepare(`
    INSERT INTO trade_closes (trade_id, close_type, price, size, pnl)
    VALUES (?, ?, ?, ?, ?)
  `).run(tradeId, closeType, price, size, pnl);

  // Mark TP hit on position
  const tpCol = closeType.toLowerCase() + "_hit";
  db.prepare(`UPDATE positions SET ${tpCol} = 1, updated_at = datetime('now') WHERE trade_id = ?`).run(tradeId);

  return pnl;
}

export function getOpenTrades() {
  return db
    .prepare(`SELECT * FROM trades WHERE status IN ('OPEN', 'PARTIAL') ORDER BY opened_at DESC`)
    .all();
}

export function getTrade(id) {
  return db.prepare("SELECT * FROM trades WHERE id = ?").get(id);
}

export function getTradeHistory(limit = 50, symbol = null) {
  const query = symbol
    ? `SELECT * FROM trades WHERE symbol = ? ORDER BY opened_at DESC LIMIT ?`
    : `SELECT * FROM trades ORDER BY opened_at DESC LIMIT ?`;
  const params = symbol ? [symbol, limit] : [limit];
  return db.prepare(query).all(...params);
}

// ── Positions ──────────────────────────────────────────────────

/**
 * Sync a live BingX position into the local DB.
 * - If a matching open trade exists, updates its unrealized P&L (and SL/TP if provided).
 * - If not, creates a synthetic EXTERNAL trade record so the dashboard can see it.
 * Returns the local trade ID.
 *
 * slPrice / tp1–3Price are optional — passed when open orders have been fetched.
 * A value of 0 means "not known" and will not overwrite an existing non-zero value.
 */
export function upsertBingXPosition({
  symbol, side, size, entryPrice, markPrice, unrealizedPnl,
  slPrice = 0, tp1Price = 0, tp2Price = 0, tp3Price = 0,
}) {
  // BingX returns "ETH-USDT" / "BTC-USD", local DB stores "ETHUSDT" / "BTCUSD"
  const localSymbol = symbol.replace("-", "");

  // ── 1. Try exact match: symbol + correct direction ─────────────
  const exact = db.prepare(`
    SELECT id, entry_price FROM trades
    WHERE symbol = ? AND direction = ? AND status IN ('OPEN', 'PARTIAL')
    ORDER BY opened_at DESC LIMIT 1
  `).get(localSymbol, side);

  if (exact) {
    // Correct zero entry_price if we now have a real value
    if ((!exact.entry_price || exact.entry_price === 0) && entryPrice > 0) {
      db.prepare(`UPDATE trades SET entry_price = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(entryPrice, exact.id);
    }
    // Update SL/TP on the trade record when we have live order data
    if (slPrice > 0 || tp1Price > 0) {
      db.prepare(`
        UPDATE trades SET
          sl_price  = CASE WHEN ? > 0 THEN ? ELSE sl_price  END,
          tp1_price = CASE WHEN ? > 0 THEN ? ELSE tp1_price END,
          tp2_price = CASE WHEN ? > 0 THEN ? ELSE tp2_price END,
          tp3_price = CASE WHEN ? > 0 THEN ? ELSE tp3_price END,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(slPrice, slPrice, tp1Price, tp1Price, tp2Price, tp2Price, tp3Price, tp3Price, exact.id);
    }
    db.prepare(`
      UPDATE positions SET mark_price = ?, unrealized_pnl = ?,
        entry_price = CASE WHEN (entry_price IS NULL OR entry_price = 0) AND ? > 0 THEN ? ELSE entry_price END,
        updated_at = datetime('now')
      WHERE trade_id = ?
    `).run(markPrice, unrealizedPnl, entryPrice, entryPrice, exact.id);
    return exact.id;
  }

  // ── 2. No exact match — check for stale EXTERNAL record with wrong direction ──
  // This happens when a position was synced with incorrect direction data
  // (e.g., BingX Hedge mode returning positionAmt > 0 for a SHORT).
  const stale = db.prepare(`
    SELECT id FROM trades
    WHERE symbol = ? AND trade_type = 'EXTERNAL' AND status IN ('OPEN', 'PARTIAL')
    ORDER BY opened_at DESC LIMIT 1
  `).get(localSymbol);

  if (stale) {
    // Correct direction, entry price, live data, and SL/TP in-place
    db.prepare(`
      UPDATE trades SET
        direction = ?, entry_price = ?, size = ?,
        sl_price  = CASE WHEN ? > 0 THEN ? ELSE sl_price  END,
        tp1_price = CASE WHEN ? > 0 THEN ? ELSE tp1_price END,
        tp2_price = CASE WHEN ? > 0 THEN ? ELSE tp2_price END,
        tp3_price = CASE WHEN ? > 0 THEN ? ELSE tp3_price END,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      side, entryPrice, size,
      slPrice, slPrice, tp1Price, tp1Price, tp2Price, tp2Price, tp3Price, tp3Price,
      stale.id
    );
    db.prepare(`
      UPDATE positions SET side = ?, entry_price = ?, size = ?,
        mark_price = ?, unrealized_pnl = ?, updated_at = datetime('now')
      WHERE trade_id = ?
    `).run(side, entryPrice, size, markPrice, unrealizedPnl, stale.id);
    return stale.id;
  }

  // ── 3. No local record at all — create a synthetic EXTERNAL trade ──
  const tradeId = db.prepare(`
    INSERT INTO trades (
      symbol, direction, trade_type, entry_price, size,
      sl_price, tp1_price, tp2_price, tp3_price,
      status, paper_trade, opened_at
    ) VALUES (?, ?, 'EXTERNAL', ?, ?, ?, ?, ?, ?, 'OPEN', 0, datetime('now'))
  `).run(localSymbol, side, entryPrice, size, slPrice, tp1Price, tp2Price, tp3Price)
    .lastInsertRowid;

  db.prepare(`
    INSERT INTO positions (trade_id, symbol, side, size, entry_price, mark_price, unrealized_pnl)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(tradeId, localSymbol, side, size, entryPrice, markPrice, unrealizedPnl);

  return tradeId;
}

/**
 * Close an EXTERNAL trade that is no longer live on BingX.
 * P&L is unknown (we don't have the exit price), so it's left null.
 * The last known unrealized_pnl from the positions table is used as
 * a rough indicator visible in trade history.
 */
export function closeExternalTrade(tradeId) {
  const pos = db.prepare("SELECT unrealized_pnl FROM positions WHERE trade_id = ?").get(tradeId);
  db.prepare(`
    UPDATE trades SET
      status = 'CLOSED',
      close_reason = 'CLOSED_ON_EXCHANGE',
      pnl = ?,
      closed_at = datetime('now'),
      updated_at = datetime('now')
    WHERE id = ? AND trade_type = 'EXTERNAL'
  `).run(pos?.unrealized_pnl ?? null, tradeId);
  db.prepare("DELETE FROM positions WHERE trade_id = ?").run(tradeId);
}

export function updatePosition(tradeId, markPrice, unrealizedPnl) {
  db.prepare(`
    UPDATE positions SET
      mark_price = ?, unrealized_pnl = ?,
      updated_at = datetime('now')
    WHERE trade_id = ?
  `).run(markPrice, unrealizedPnl, tradeId);
}

export function getOpenPositions() {
  return db.prepare(`
    SELECT p.*, t.direction, t.entry_price as trade_entry, t.trade_type
    FROM positions p
    JOIN trades t ON p.trade_id = t.id
    WHERE t.status IN ('OPEN', 'PARTIAL')
  `).all();
}

// ── Snapshots ─────────────────────────────────────────────────

export function saveSnapshot(capital) {
  const trades = getTradeHistory(1000);
  const closedTrades = trades.filter((t) => t.status === "CLOSED");
  const totalPnl = closedTrades.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const today = closedTrades.filter(
    (t) => t.closed_at?.startsWith(new Date().toISOString().slice(0, 10))
  );
  const dayPnl = today.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const wins = closedTrades.filter((t) => (t.pnl ?? 0) > 0).length;
  const losses = closedTrades.filter((t) => (t.pnl ?? 0) <= 0).length;
  const openCount = getOpenTrades().length;

  db.prepare(`
    INSERT INTO snapshots (capital, total_pnl, day_pnl, open_positions, win_count, loss_count, date)
    VALUES (?, ?, ?, ?, ?, ?, date('now'))
    ON CONFLICT(date) DO UPDATE SET
      capital = excluded.capital,
      total_pnl = excluded.total_pnl,
      day_pnl = excluded.day_pnl,
      open_positions = excluded.open_positions,
      win_count = excluded.win_count,
      loss_count = excluded.loss_count
  `).run(capital, totalPnl, dayPnl, openCount, wins, losses);
}

export function getSnapshots(days = 30) {
  return db
    .prepare(
      `SELECT * FROM snapshots ORDER BY date DESC LIMIT ?`
    )
    .all(days)
    .reverse(); // chronological order
}

// ── Analytics ─────────────────────────────────────────────────

export function getStats() {
  const closed = db
    .prepare(`SELECT pnl, pnl_pct FROM trades WHERE status = 'CLOSED' AND pnl IS NOT NULL`)
    .all();

  if (closed.length === 0) {
    return { totalTrades: 0, winRate: 0, avgPnl: 0, totalPnl: 0, maxDrawdown: 0 };
  }

  const wins = closed.filter((t) => t.pnl > 0);
  const losses = closed.filter((t) => t.pnl <= 0);
  const totalPnl = closed.reduce((s, t) => s + t.pnl, 0);
  const avgPnl = totalPnl / closed.length;
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;
  const expectancy = (wins.length / closed.length) * avgWin + (losses.length / closed.length) * avgLoss;

  // Max drawdown from snapshots
  const snaps = getSnapshots(365);
  let peak = 0;
  let maxDD = 0;
  for (const s of snaps) {
    if (s.capital > peak) peak = s.capital;
    const dd = peak > 0 ? (peak - s.capital) / peak : 0;
    if (dd > maxDD) maxDD = dd;
  }

  return {
    totalTrades: closed.length,
    winCount: wins.length,
    lossCount: losses.length,
    winRate: parseFloat(((wins.length / closed.length) * 100).toFixed(1)),
    avgPnl: parseFloat(avgPnl.toFixed(2)),
    totalPnl: parseFloat(totalPnl.toFixed(2)),
    avgWin: parseFloat(avgWin.toFixed(2)),
    avgLoss: parseFloat(avgLoss.toFixed(2)),
    expectancy: parseFloat(expectancy.toFixed(2)),
    maxDrawdown: parseFloat((maxDD * 100).toFixed(2)),
  };
}

// ── Helpers ────────────────────────────────────────────────────
function parseSignalRow(row) {
  if (!row) return null;
  return {
    ...row,
    breakdown:     row.breakdown     ? JSON.parse(row.breakdown)     : {},
    inputs:        row.inputs        ? JSON.parse(row.inputs)        : {},
    rationale:     row.rationale     ? JSON.parse(row.rationale)     : [],
    scale_entries: row.scale_entries ? JSON.parse(row.scale_entries) : [],
  };
}
