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

/**
 * Parse um row bruto da tabela signals: desserializa colunas JSON
 * (breakdown, inputs, scale_entries) para facilitar consumo no frontend.
 */
function parseSignalRow(row) {
  if (!row) return null;
  const parse = (v) => {
    if (v == null) return null;
    if (typeof v !== "string") return v;
    try { return JSON.parse(v); } catch { return v; }
  };
  return {
    ...row,
    breakdown:     parse(row.breakdown),
    inputs:        parse(row.inputs),
    scale_entries: parse(row.scale_entries),
  };
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

// ── Watchlist (sinais rejeitados por score, mas com setup triggado) ──
// Serve pra:
//   1. Dashboard mostrar "quase entrou" e a gente aprender visualmente
//      quantos trades perdeu por excesso de conservadorismo.
//   2. Backtest offline recalibrar pesos dos modifiers e MIN_SCORE.
export function getBelowThresholdSignals(limit = 50) {
  return db
    .prepare(
      `SELECT * FROM signals
       WHERE status = 'BELOW_THRESHOLD'
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(limit)
    .map(parseSignalRow);
}

// Dedup helper: procura sinal ativo (PENDING_APPROVAL/APPROVED) do mesmo
// symbol+direction criado nas últimas N horas. Usado pelo scanner pra
// evitar emitir sinais duplicados a cada ciclo (scanner roda a cada 5min
// mas setups de H4 não mudam em 5min).
export function findRecentActiveSignal(symbol, direction, hoursWindow = 4) {
  const row = db
    .prepare(
      `SELECT * FROM signals
       WHERE symbol = ?
         AND direction = ?
         AND status IN ('PENDING_APPROVAL', 'APPROVED')
         AND datetime(created_at) > datetime('now', ?)
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get(symbol, direction, `-${hoursWindow} hours`);
  return row ? parseSignalRow(row) : null;
}

// Marca sinais ativos do mesmo symbol+direction como SUPERSEDED quando um
// deles vira trade. Chamado pelo executor após criar trade com sucesso.
// Retorna número de sinais marcados.
export function markSignalsSuperseded(symbol, direction, hoursWindow, winnerSignalId) {
  const result = db
    .prepare(
      `UPDATE signals
          SET status = 'SUPERSEDED',
              superseded_by = ?,
              updated_at = datetime('now')
        WHERE symbol = ?
          AND direction = ?
          AND status IN ('PENDING_APPROVAL', 'APPROVED')
          AND id != ?
          AND datetime(created_at) > datetime('now', ?)`
    )
    .run(winnerSignalId, symbol, direction, winnerSignalId, `-${hoursWindow} hours`);
  return result.changes;
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

  // Marca outros sinais ativos do mesmo symbol+direction como SUPERSEDED.
  // Janela de 4h alinhada com SIGNAL_DEDUP_HOURS do scanner. Evita sinais
  // órfãos ficarem como APPROVED quando só um virou trade.
  try {
    const superseded = markSignalsSuperseded(signal.symbol, signal.direction, 4, signalId);
    if (superseded > 0) {
      console.log(`[TRADES] ${superseded} signal(s) marcado(s) SUPERSEDED (winner: #${signalId})`);
    }
  } catch (err) {
    // Não trava a abertura do trade se o cleanup falhar
    console.warn(`[TRADES] markSignalsSuperseded falhou: ${err.message}`);
  }

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

/**
 * Retorna o P&L total realizado de um trade: soma de trade_closes (TP1/TP2)
 * + pnl final de trades.pnl (lote final fechado por TP3/SL).
 * Útil para decidir se o trade terminou net-positivo.
 */
export function getTotalTradePnl(tradeId) {
  const partials = db.prepare(
    "SELECT COALESCE(SUM(pnl), 0) AS total FROM trade_closes WHERE trade_id = ?"
  ).get(tradeId);
  const trade = db.prepare(
    "SELECT COALESCE(pnl, 0) AS pnl FROM trades WHERE id = ?"
  ).get(tradeId);
  return (partials?.total ?? 0) + (trade?.pnl ?? 0);
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
  return db.prepare(`
    SELECT t.*, p.unrealized_pnl, p.mark_price
    FROM trades t
    LEFT JOIN positions p ON p.trade_id = t.id
    WHERE t.status IN ('OPEN', 'PARTIAL')
    ORDER BY t.opened_at DESC
  `).all();
}

export function getTrade(id) {
  return db.prepare("SELECT * FROM trades WHERE id = ?").get(id);
}

export function getTradeHistory(limit = 50, symbol = null) {
  const query = symbol
    ? `SELECT t.*, s.setup_name, s.rationale, s.score as signal_score, s.breakdown
       FROM trades t LEFT JOIN signals s ON t.signal_id = s.id
       WHERE t.symbol = ? ORDER BY t.opened_at DESC LIMIT ?`
    : `SELECT t.*, s.setup_name, s.rationale, s.score as signal_score, s.breakdown
       FROM trades t LEFT JOIN signals s ON t.signal_id = s.id
       ORDER BY t.opened_at DESC LIMIT ?`;
  const params = symbol ? [symbol, limit] : [limit];
  return db.prepare(query).all(...params).map((row) => ({
    ...row,
    rationale:  row.rationale  ? JSON.parse(row.rationale)  : [],
    breakdown:  row.breakdown  ? JSON.parse(row.breakdown)  : {},
  }));
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
  // BingX returns "ETH-USDC" / "BTC-USDC", local DB stores "ETHUSDC" / "BTCUSDC"
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

/**
 * Close a bot-created trade that disappeared from BingX (SL/TP likely hit).
 * Unlike closeExternalTrade, this works on any trade_type.
 * P&L is taken from the last known unrealized_pnl (rough approximation).
 */
export function closeBotTradeFromSync(tradeId) {
  const pos = db.prepare("SELECT unrealized_pnl FROM positions WHERE trade_id = ?").get(tradeId);
  db.prepare(`
    UPDATE trades SET
      status = 'STOPPED',
      close_reason = 'BINGX_CLOSED',
      pnl = ?,
      closed_at = datetime('now'),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(pos?.unrealized_pnl ?? null, tradeId);
  db.prepare("DELETE FROM positions WHERE trade_id = ?").run(tradeId);
}

/**
 * Delete all closed/stopped trades (and their signals).
 * Used by the dashboard "Clear History" action.
 * Open positions are NOT affected.
 */
export function clearClosedTrades() {
  // Must delete child rows first to satisfy foreign key constraints:
  //   trade_closes(trade_id) → trades(id)
  //   positions(trade_id)    → trades(id)
  //
  // node:sqlite uses DatabaseSync which has no .transaction() helper —
  // use explicit BEGIN/COMMIT instead.
  const closedIds = db.prepare(
    "SELECT id FROM trades WHERE status NOT IN ('OPEN', 'PARTIAL')"
  ).all().map((r) => r.id);

  if (closedIds.length === 0) return 0;

  // Build a comma-separated placeholder string: ?,?,?
  const ph = closedIds.map(() => "?").join(",");

  db.exec("BEGIN");
  try {
    db.prepare(`DELETE FROM trade_closes WHERE trade_id IN (${ph})`).run(...closedIds);
    db.prepare(`DELETE FROM positions   WHERE trade_id IN (${ph})`).run(...closedIds);
    const result = db.prepare(`DELETE FROM trades WHERE id IN (${ph})`).run(...closedIds);
    db.exec("COMMIT");
    return result.changes;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function updatePosition(tradeId, markPrice, unrealizedPnl) {
  db.prepare(`
    UPDATE positions SET
      mark_price = ?, unrealized_pnl = ?,
      updated_at = datetime('now')
    WHERE trade_id = ?
  `).run(markPrice, unrealizedPnl, tradeId);
}

/**
 * Atualiza o SL de um trade e sua posição associada.
 * Usado pelo break-even trigger após TP1.
 *
 * @param {number} tradeId
 * @param {number} newSlPrice
 * @param {string} [reason] — livre ("BE", "TRAIL", "MANUAL")
 */
export function updateTradeStopLoss(tradeId, newSlPrice, reason = "") {
  db.prepare(`
    UPDATE trades SET
      sl_price   = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(newSlPrice, tradeId);

  db.prepare(`
    UPDATE positions SET
      sl_price   = ?,
      updated_at = datetime('now')
    WHERE trade_id = ?
  `).run(newSlPrice, tradeId);

  if (reason) {
    console.log(`[SL_UPDATE] Trade #${tradeId} SL → $${newSlPrice} (${reason})`);
  }
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

// ── Daily Risk Limit ──────────────────────────────────────────

/**
 * Returns the sum of realized P&L for today's closed trades (UTC date).
 * A negative value means net losses. Returns 0 if no trades closed today.
 */
export function getDailyPnl() {
  const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
  const row = db.prepare(`
    SELECT COALESCE(SUM(pnl), 0) AS total
    FROM trades
    WHERE DATE(closed_at) = ? AND status IN ('CLOSED', 'STOPPED') AND pnl IS NOT NULL
  `).get(today);
  return row?.total ?? 0;
}

/**
 * Returns true when today's realized losses have reached the daily limit.
 * @param {number} capital    — current total capital in USDT
 * @param {number} limitPct   — fraction of capital (default 0.01 = 1%)
 */
export function isDailyLimitReached(capital, limitPct = 0.01) {
  if (!capital || capital <= 0) return false;
  return getDailyPnl() <= -(capital * limitPct);
}

/**
 * Returns the sum of realized PROFITS for today's closed trades (UTC date).
 * Only counts positive P&L (winning trades). Returns 0 if none.
 */
export function getDailyProfit() {
  const today = new Date().toISOString().slice(0, 10);
  const row = db.prepare(`
    SELECT COALESCE(SUM(pnl), 0) AS total
    FROM trades
    WHERE DATE(closed_at) = ? AND status IN ('CLOSED', 'STOPPED') AND pnl > 0
  `).get(today);
  return row?.total ?? 0;
}

/**
 * Returns true when today's realized profit has reached the daily target.
 * @param {number} targetAmount — fixed dollar amount (e.g. 10)
 */
export function isDailyTargetReached(targetAmount) {
  if (!targetAmount || targetAmount <= 0) return false;
  return getDailyProfit() >= targetAmount;
}

// ── Weekly / Monthly P&L ──────────────────────────────────────

/**
 * Retorna P&L realizado do mês corrente (primeiro ao último dia).
 * @returns {{ pnl: number, tradeCount: number, winCount: number, lossCount: number }}
 */
export function getMonthlyPnl() {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const lastDay  = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

  const rows = db.prepare(`
    SELECT pnl FROM trades
    WHERE DATE(closed_at) BETWEEN ? AND ?
      AND status IN ('CLOSED', 'STOPPED')
      AND pnl IS NOT NULL
  `).all(firstDay, lastDay);

  const pnl       = rows.reduce((s, r) => s + (r.pnl ?? 0), 0);
  const winCount  = rows.filter((r) => r.pnl > 0).length;
  const lossCount = rows.filter((r) => r.pnl <= 0).length;

  return {
    pnl:        parseFloat(pnl.toFixed(2)),
    tradeCount: rows.length,
    winCount,
    lossCount,
    winRate:    rows.length ? parseFloat(((winCount / rows.length) * 100).toFixed(1)) : 0,
    firstDay,
    lastDay,
  };
}

/**
 * Retorna P&L realizado da semana corrente (segunda → domingo).
 */
export function getWeeklyPnl() {
  const now     = new Date();
  const day     = now.getUTCDay() || 7; // 0=Dom → 7
  const monday  = new Date(now);
  monday.setUTCDate(now.getUTCDate() - (day - 1));
  const first   = monday.toISOString().slice(0, 10);
  const today   = now.toISOString().slice(0, 10);

  const rows = db.prepare(`
    SELECT pnl FROM trades
    WHERE DATE(closed_at) BETWEEN ? AND ?
      AND status IN ('CLOSED', 'STOPPED')
      AND pnl IS NOT NULL
  `).all(first, today);

  const pnl = rows.reduce((s, r) => s + (r.pnl ?? 0), 0);
  return {
    pnl:        parseFloat(pnl.toFixed(2)),
    tradeCount: rows.length,
    firstDay:   first,
    today,
  };
}
/**
 * Série diária de P&L para gráficos de barras.
 * Retorna array: [{ date: 'YYYY-MM-DD', pnl, tradeCount }]
 *
 * @param {number} days - quantos dias retornar (default 30)
 */
export function getDailyPnlSeries(days = 30) {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - days + 1);
  const startIso = start.toISOString().slice(0, 10);

  const rows = db.prepare(`
    SELECT DATE(closed_at) AS date,
           COALESCE(SUM(pnl), 0) AS pnl,
           COUNT(*) AS tradeCount
    FROM trades
    WHERE closed_at >= ?
      AND status IN ('CLOSED', 'STOPPED')
      AND pnl IS NOT NULL
    GROUP BY DATE(closed_at)
    ORDER BY date ASC
  `).all(startIso);

  return rows.map((r) => ({
    date: r.date,
    pnl: parseFloat((r.pnl ?? 0).toFixed(2)),
    tradeCount: r.tradeCount,
  }));
}

/**
 * Série mensal de P&L para gráficos comparativos.
 */
export function getMonthlyPnlSeries(months = 12) {
  const rows = db.prepare(`
    SELECT strftime('%Y-%m', closed_at) AS month,
           COALESCE(SUM(pnl), 0) AS pnl,
           COUNT(*) AS tradeCount
    FROM trades
    WHERE status IN ('CLOSED', 'STOPPED')
      AND pnl IS NOT NULL
    GROUP BY month
    ORDER BY month DESC
    LIMIT ?
  `).all(months);

  return rows.reverse().map((r) => ({
    month: r.month,
    pnl: parseFloat((r.pnl ?? 0).toFixed(2)),
    tradeCount: r.tradeCount,
  }));
}

/**
 * Estatísticas por setup (JOIN com signals para obter setup_id).
 */
export function getStatsBySetup() {
  const rows = db.prepare(`
    SELECT
      COALESCE(s.setup_id, 'UNKNOWN') AS setup_id,
      COUNT(t.id) AS trades,
      SUM(CASE WHEN t.pnl > 0 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN t.pnl <= 0 THEN 1 ELSE 0 END) AS losses,
      COALESCE(SUM(t.pnl), 0) AS totalPnl,
      COALESCE(AVG(t.pnl), 0) AS avgPnl,
      COALESCE(AVG(CASE WHEN t.sl_price IS NOT NULL AND t.entry_price IS NOT NULL AND t.sl_price != t.entry_price
                        THEN t.pnl / (t.size * ABS(t.entry_price - t.sl_price))
                        ELSE NULL END), 0) AS avgR
    FROM trades t
    LEFT JOIN signals s ON t.signal_id = s.id
    WHERE t.status IN ('CLOSED', 'STOPPED')
      AND t.pnl IS NOT NULL
    GROUP BY COALESCE(s.setup_id, 'UNKNOWN')
    ORDER BY totalPnl DESC
  `).all();

  return rows.map((r) => ({
    setup_id: r.setup_id,
    trades: r.trades,
    wins: r.wins,
    losses: r.losses,
    winRate: r.trades > 0 ? parseFloat(((r.wins / r.trades) * 100).toFixed(1)) : 0,
    totalPnl: parseFloat((r.totalPnl ?? 0).toFixed(2)),
    avgPnl: parseFloat((r.avgPnl ?? 0).toFixed(2)),
    avgR: parseFloat((r.avgR ?? 0).toFixed(2)),
  }));
}

/**
 * Estatísticas por símbolo.
 */
export function getStatsBySymbol() {
  const rows = db.prepare(`
    SELECT
      symbol,
      COUNT(*) AS trades,
      SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN pnl <= 0 THEN 1 ELSE 0 END) AS losses,
      COALESCE(SUM(pnl), 0) AS totalPnl,
      COALESCE(AVG(pnl), 0) AS avgPnl
    FROM trades
    WHERE status IN ('CLOSED', 'STOPPED')
      AND pnl IS NOT NULL
    GROUP BY symbol
    ORDER BY totalPnl DESC
  `).all();

  return rows.map((r) => ({
    symbol: r.symbol,
    trades: r.trades,
    wins: r.wins,
    losses: r.losses,
    winRate: r.trades > 0 ? parseFloat(((r.wins / r.trades) * 100).toFixed(1)) : 0,
    totalPnl: parseFloat((r.totalPnl ?? 0).toFixed(2)),
    avgPnl: parseFloat((r.avgPnl ?? 0).toFixed(2)),
  }));
}

/**
 * Série de drawdown: cumPnl, peak, dd% e dd$ por data.
 */
export function getDrawdownSeries(days = 90) {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - days + 1);
  const startIso = start.toISOString().slice(0, 10);

  const rows = db.prepare(`
    SELECT DATE(closed_at) AS date,
           COALESCE(SUM(pnl), 0) AS pnl
    FROM trades
    WHERE closed_at >= ?
      AND status IN ('CLOSED', 'STOPPED')
      AND pnl IS NOT NULL
    GROUP BY DATE(closed_at)
    ORDER BY date ASC
  `).all(startIso);

  let cum = 0;
  let peak = 0;
  return rows.map((r) => {
    cum += r.pnl ?? 0;
    if (cum > peak) peak = cum;
    const ddDollar = cum - peak;
    const ddPct = peak > 0 ? (ddDollar / peak) * 100 : 0;
    return {
      date: r.date,
      cumulativePnl: parseFloat(cum.toFixed(2)),
      peak: parseFloat(peak.toFixed(2)),
      drawdownDollar: parseFloat(ddDollar.toFixed(2)),
      drawdownPct: parseFloat(ddPct.toFixed(2)),
    };
  });
}

/**
 * Distribuição por motivo de fechamento.
 */
export function getCloseReasonBreakdown() {
  const rows = db.prepare(`
    SELECT
      COALESCE(close_reason, 'UNKNOWN') AS reason,
      COUNT(*) AS count,
      COALESCE(SUM(pnl), 0) AS totalPnl
    FROM trades
    WHERE status IN ('CLOSED', 'STOPPED')
      AND pnl IS NOT NULL
    GROUP BY reason
    ORDER BY count DESC
  `).all();

  return rows.map((r) => ({
    reason: r.reason,
    count: r.count,
    totalPnl: parseFloat((r.totalPnl ?? 0).toFixed(2)),
  }));
}

// ═══════════════════════════════════════════════════════════════════
//  AGGREGATE STATS  (para StatsPanel e /api/stats)
// ═══════════════════════════════════════════════════════════════════

export function getStats() {
  // Trades fechados (inclui STOPPED)
  const closed = db.prepare(`
    SELECT pnl
    FROM trades
    WHERE status IN ('CLOSED', 'STOPPED')
      AND pnl IS NOT NULL
  `).all();

  const totalTrades = closed.length;
  const wins        = closed.filter((t) => t.pnl > 0);
  const losses      = closed.filter((t) => t.pnl < 0);
  const winCount    = wins.length;
  const lossCount   = losses.length;
  const winRate     = totalTrades > 0 ? parseFloat(((winCount / totalTrades) * 100).toFixed(1)) : 0;
  const totalPnl    = closed.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const avgWin      = wins.length   > 0 ? wins.reduce((s, t) => s + t.pnl, 0)   / wins.length   : 0;
  const avgLoss     = losses.length > 0 ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;

  // Expectancy: E = (winRate * avgWin) + (lossRate * avgLoss)
  const winRateFrac  = totalTrades > 0 ? winCount  / totalTrades : 0;
  const lossRateFrac = totalTrades > 0 ? lossCount / totalTrades : 0;
  const expectancy   = (winRateFrac * avgWin) + (lossRateFrac * avgLoss);

  // Unrealized PnL das posicoes abertas
  const openTrades = db.prepare(`
    SELECT t.direction, t.entry_price, t.size, p.mark_price, p.unrealized_pnl
    FROM trades t
    LEFT JOIN positions p ON p.trade_id = t.id
    WHERE t.status = 'OPEN'
  `).all();

  const unrealizedPnl = openTrades.reduce((sum, t) => {
    if (t.unrealized_pnl != null) return sum + t.unrealized_pnl;
    if (t.mark_price != null && t.entry_price != null && t.size != null) {
      const pnl = t.direction === "LONG"
        ? (t.mark_price - t.entry_price) * t.size
        : (t.entry_price - t.mark_price) * t.size;
      return sum + pnl;
    }
    return sum;
  }, 0);

  // Profit factor = gross wins / |gross losses|
  const grossWins   = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLosses = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLosses > 0 ? parseFloat((grossWins / grossLosses).toFixed(2)) : null;

  return {
    totalTrades,
    winCount,
    lossCount,
    winRate,
    totalPnl:      parseFloat(totalPnl.toFixed(2)),
    avgWin:        parseFloat(avgWin.toFixed(2)),
    avgLoss:       parseFloat(avgLoss.toFixed(2)),
    expectancy:    parseFloat(expectancy.toFixed(2)),
    profitFactor,
    unrealizedPnl: parseFloat(unrealizedPnl.toFixed(2)),
    openCount:     openTrades.length,
  };
}
