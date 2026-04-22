// ─────────────────────────────────────────────────────────────────
//  PnlBreakdownChart — Bar chart: TP gains / SL losses / fees
//  Green bars = TP profit | Red bars = SL loss | Yellow = estimated fees
//  Three bars side by side per period, all periods shown (no limit)
//  Time selector: Daily (all history) or Monthly (all history)
// ─────────────────────────────────────────────────────────────────

import { useState, useMemo, useRef } from "react";

// BingX taker fee rate (0.05% per side = 0.1% round-trip)
const TAKER_FEE_RATE = 0.0005;

// ── Helpers ───────────────────────────────────────────────────────

function estimateFee(trade) {
  // Fee = entry_value × TAKER_FEE_RATE × 2 (open + close)
  const value = (trade.entry_price ?? 0) * (trade.size ?? 0);
  return value * TAKER_FEE_RATE * 2;
}

function formatDate(dateStr, mode) {
  if (!dateStr) return "?";
  const d = new Date(dateStr);
  if (mode === "monthly") {
    return d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
  }
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function getPeriodKey(dateStr, mode) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (mode === "monthly") {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  return dateStr.slice(0, 10); // YYYY-MM-DD
}

// ── Chart Bar Group (TP | SL | Fee side by side) ─────────────────

const BAR_HEIGHT = 160; // px — max individual bar height
const BAR_WIDTH  = 10;  // px — width of each individual bar

function Bar({ tp, sl, fees, maxAbs, label, net }) {
  const [hovered, setHovered] = useState(false);
  const ref = useRef(null);

  // Scale each bar independently against the global max
  // maxAbs = max of any single bar value across all periods
  const scale = maxAbs > 0 ? BAR_HEIGHT / maxAbs : 0;

  const tpH  = Math.max(tp   * scale, tp   > 0 ? 3 : 0);
  const slH  = Math.max(sl   * scale, sl   > 0 ? 3 : 0);
  const feeH = Math.max(fees * scale, fees > 0 ? 3 : 0);

  const netColor  = net >= 0 ? "#4ade80" : "#f87171";
  const netPrefix = net >= 0 ? "+" : "";

  return (
    <div
      ref={ref}
      className="flex flex-col items-center flex-shrink-0"
      style={{ width: `${BAR_WIDTH * 3 + 8}px`, gap: "4px", position: "relative" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Tooltip — rendered above via fixed positioning trick using transform */}
      {hovered && (
        <div
          style={{
            position: "absolute",
            bottom: "100%",
            left: "50%",
            transform: "translateX(-50%)",
            marginBottom: "6px",
            zIndex: 9999,
            background: "var(--color-card, #1a1a2e)",
            border: "1px solid var(--color-border, #333)",
            borderRadius: "4px",
            padding: "6px 8px",
            fontSize: "11px",
            display: "flex",
            flexDirection: "column",
            gap: "2px",
            pointerEvents: "none",
            whiteSpace: "nowrap",
            boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
          }}
        >
          <span style={{ color: "#4ade80" }}>TP  +${tp.toFixed(2)}</span>
          <span style={{ color: "#f87171" }}>SL  -${sl.toFixed(2)}</span>
          <span style={{ color: "#facc15" }}>Fee -${fees.toFixed(2)}</span>
          <span
            style={{
              color: netColor,
              fontWeight: "bold",
              borderTop: "1px solid rgba(255,255,255,0.1)",
              paddingTop: "3px",
              marginTop: "1px",
            }}
          >
            Net {netPrefix}${Math.abs(net).toFixed(2)}
          </span>
        </div>
      )}

      {/* 3 bars side by side, bottom-aligned */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: "2px",
          height: `${BAR_HEIGHT}px`,
          width: "100%",
        }}
      >
        {/* TP — green */}
        <div
          style={{
            width: `${BAR_WIDTH}px`,
            height: `${tpH}px`,
            backgroundColor: hovered ? "#4ade80" : "rgba(74,222,128,0.75)",
            borderRadius: "2px 2px 0 0",
            flexShrink: 0,
            transition: "background-color 0.15s",
            alignSelf: "flex-end",
          }}
        />
        {/* SL — red */}
        <div
          style={{
            width: `${BAR_WIDTH}px`,
            height: `${slH}px`,
            backgroundColor: hovered ? "#f87171" : "rgba(248,113,113,0.75)",
            borderRadius: "2px 2px 0 0",
            flexShrink: 0,
            transition: "background-color 0.15s",
            alignSelf: "flex-end",
          }}
        />
        {/* Fee — yellow */}
        <div
          style={{
            width: `${BAR_WIDTH}px`,
            height: `${feeH}px`,
            backgroundColor: hovered ? "#facc15" : "rgba(250,204,21,0.65)",
            borderRadius: "2px 2px 0 0",
            flexShrink: 0,
            transition: "background-color 0.15s",
            alignSelf: "flex-end",
          }}
        />
      </div>

      {/* Base line */}
      <div style={{ width: "100%", height: "1px", backgroundColor: "rgba(255,255,255,0.1)" }} />

      {/* Date label */}
      <span
        style={{
          fontSize: "9px",
          color: "rgba(160,160,180,0.7)",
          textAlign: "center",
          width: "100%",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>

      {/* Net P&L */}
      <span
        style={{
          fontSize: "9px",
          fontFamily: "monospace",
          fontWeight: "600",
          color: netColor,
        }}
      >
        {netPrefix}${Math.abs(net).toFixed(2)}
      </span>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────

export function PnlBreakdownChart({ trades = [] }) {
  const [mode, setMode] = useState("daily"); // "daily" | "monthly"

  const closedTrades = trades.filter(
    (t) => (t.status === "CLOSED" || t.status === "STOPPED") && t.pnl != null
  );

  // ── Aggregate by period — show ALL history, no limit ──────────
  const periods = useMemo(() => {
    const map = {};

    for (const t of closedTrades) {
      const key = getPeriodKey(t.closed_at, mode);
      if (!key) continue;

      if (!map[key]) map[key] = { tp: 0, sl: 0, fees: 0, label: formatDate(t.closed_at, mode) };

      const fee = estimateFee(t);
      if (t.pnl > 0) {
        map[key].tp += t.pnl;
      } else {
        map[key].sl += Math.abs(t.pnl);
      }
      map[key].fees += fee;
    }

    // Sort chronologically — no slice, show everything
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => ({ ...v, key }));
  }, [closedTrades, mode]);

  // ── Scale: max of any SINGLE bar value (not sum) for side-by-side ──
  // Each bar (TP, SL, fee) is scaled independently, so we use the
  // max individual value — not the stacked sum — as the reference.
  const maxAbs = useMemo(() => {
    if (!periods.length) return 1;
    return Math.max(
      ...periods.flatMap((p) => [p.tp, p.sl, p.fees]),
      0.01
    );
  }, [periods]);

  // ── Summary totals ────────────────────────────────────────────
  const totals = useMemo(() => {
    return periods.reduce(
      (acc, p) => ({
        tp:   acc.tp   + p.tp,
        sl:   acc.sl   + p.sl,
        fees: acc.fees + p.fees,
      }),
      { tp: 0, sl: 0, fees: 0 }
    );
  }, [periods]);

  const totalNet = totals.tp - totals.sl - totals.fees;
  const netColor = totalNet >= 0 ? "text-positive" : "text-negative";

  const profitDays = periods.filter((p) => p.tp - p.sl - p.fees > 0).length;
  const lossDays   = periods.filter((p) => p.tp - p.sl - p.fees < 0).length;

  // Chart area height: BAR_HEIGHT + labels + padding
  const chartAreaHeight = BAR_HEIGHT + 56;

  return (
    <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xs text-muted tracking-wider">P&L BREAKDOWN</h2>
        <div className="flex items-center gap-2">
          {/* Legend */}
          <div className="flex items-center gap-3 mr-2">
            <span className="flex items-center gap-1 text-xs text-muted/70">
              <span className="w-2 h-2 rounded-sm inline-block" style={{ backgroundColor: "rgba(74,222,128,0.75)" }} /> TP
            </span>
            <span className="flex items-center gap-1 text-xs text-muted/70">
              <span className="w-2 h-2 rounded-sm inline-block" style={{ backgroundColor: "rgba(248,113,113,0.75)" }} /> SL
            </span>
            <span className="flex items-center gap-1 text-xs text-muted/70">
              <span className="w-2 h-2 rounded-sm inline-block" style={{ backgroundColor: "rgba(250,204,21,0.65)" }} /> Fees
            </span>
          </div>
          {/* Time selector */}
          <div className="flex rounded border border-border overflow-hidden">
            <button
              onClick={() => setMode("daily")}
              className={`px-3 py-1 text-xs transition-colors ${
                mode === "daily"
                  ? "bg-accent/20 text-accent"
                  : "text-muted hover:text-text"
              }`}
            >
              Daily
            </button>
            <button
              onClick={() => setMode("monthly")}
              className={`px-3 py-1 text-xs transition-colors border-l border-border ${
                mode === "monthly"
                  ? "bg-accent/20 text-accent"
                  : "text-muted hover:text-text"
              }`}
            >
              Monthly
            </button>
          </div>
        </div>
      </div>

      {/* Summary strip */}
      <div className="flex items-center gap-4 text-xs border border-border/40 rounded px-3 py-2 bg-bg/40">
        <span className="text-positive font-mono">+${totals.tp.toFixed(2)} TP</span>
        <span className="text-border/60">|</span>
        <span className="text-negative font-mono">-${totals.sl.toFixed(2)} SL</span>
        <span className="text-border/60">|</span>
        <span className="text-yellow-400 font-mono">-${totals.fees.toFixed(2)} Fees</span>
        <span className="text-border/60">|</span>
        <span className={`font-mono font-bold ${netColor}`}>
          Net {totalNet >= 0 ? "+" : ""}{totalNet.toFixed(2)}
        </span>
        <span className="text-border/60 ml-auto">|</span>
        <span className="text-positive">{profitDays} lucro</span>
        <span className="text-negative">{lossDays} prejuízo</span>
      </div>

      {/* Chart — overflow-x-auto for scrolling, overflow-y-visible for tooltips */}
      {periods.length === 0 ? (
        <div className="flex items-center justify-center text-muted/50 text-xs" style={{ height: `${chartAreaHeight}px` }}>
          Nenhum trade fechado ainda.
        </div>
      ) : (
        <div
          style={{
            overflowX: "auto",
            overflowY: "visible",
            paddingBottom: "4px",
            paddingTop: `${BAR_HEIGHT / 2}px`, // top padding so tooltips have room
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: "12px",           // space between day groups
              minHeight: `${chartAreaHeight}px`,
              width: "max-content",  // let it grow naturally for scrolling
              position: "relative",
            }}
          >
            {periods.map((p) => (
              <Bar
                key={p.key}
                tp={p.tp}
                sl={p.sl}
                fees={p.fees}
                maxAbs={maxAbs}
                label={p.label}
                net={p.tp - p.sl - p.fees}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
