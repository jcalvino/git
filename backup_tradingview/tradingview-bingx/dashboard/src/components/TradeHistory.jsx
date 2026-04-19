import React, { useState } from "react";

export function TradeHistory({ trades = [] }) {
  const [filter, setFilter] = useState("ALL");

  const filtered =
    filter === "ALL"
      ? trades
      : filter === "WIN"
      ? trades.filter((t) => (t.pnl ?? 0) > 0)
      : filter === "LOSS"
      ? trades.filter((t) => t.status === "CLOSED" && (t.pnl ?? 0) <= 0)
      : trades.filter((t) => t.symbol === filter);

  const symbols = [...new Set(trades.map((t) => t.symbol))];

  return (
    <div>
      {/* Filters */}
      <div className="flex gap-2 mb-3">
        {["ALL", "WIN", "LOSS", ...symbols].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded text-xs border transition-colors ${
              filter === f
                ? "bg-accent/20 border-accent text-accent"
                : "border-border text-muted hover:border-text-dim"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted border-b border-border">
              <th className="text-left py-2 pr-4">Date</th>
              <th className="text-left py-2 pr-4">Symbol</th>
              <th className="text-left py-2 pr-4">Dir</th>
              <th className="text-right py-2 pr-4">Entry</th>
              <th className="text-right py-2 pr-4">Exit</th>
              <th className="text-right py-2 pr-4">P&L</th>
              <th className="text-right py-2 pr-4">P&L %</th>
              <th className="text-right py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="text-muted text-center py-6">
                  No trades found
                </td>
              </tr>
            )}
            {filtered.map((t) => {
              const pnl = t.pnl ?? 0;
              const isProfit = pnl > 0;
              const pnlColor =
                t.status === "OPEN"
                  ? "text-text-dim"
                  : isProfit
                  ? "text-positive"
                  : "text-negative";

              return (
                <tr
                  key={t.id}
                  className="border-b border-border/50 hover:bg-card/50 transition-colors"
                >
                  <td className="py-2 pr-4 text-muted">
                    {new Date(t.opened_at).toLocaleDateString("en-US")}
                  </td>
                  <td className="py-2 pr-4 font-medium">{t.symbol}</td>
                  <td className="py-2 pr-4">
                    <span
                      className={
                        t.direction === "LONG" ? "text-positive" : "text-negative"
                      }
                    >
                      {t.direction}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-right">
                    ${t.entry_price?.toLocaleString()}
                  </td>
                  <td className="py-2 pr-4 text-right">
                    {t.exit_price ? `$${t.exit_price.toLocaleString()}` : "—"}
                  </td>
                  <td className={`py-2 pr-4 text-right font-medium ${pnlColor}`}>
                    {t.status === "OPEN"
                      ? "open"
                      : `${isProfit ? "+" : ""}$${pnl.toFixed(2)}`}
                  </td>
                  <td className={`py-2 pr-4 text-right ${pnlColor}`}>
                    {t.pnl_pct !== null && t.pnl_pct !== undefined
                      ? `${isProfit ? "+" : ""}${t.pnl_pct.toFixed(2)}%`
                      : "—"}
                  </td>
                  <td className="py-2 text-right">
                    <StatusBadge status={t.status} reason={t.close_reason} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status, reason }) {
  const map = {
    OPEN: "bg-accent/20 text-accent",
    PARTIAL: "bg-accent/20 text-accent",
    CLOSED: "bg-muted/20 text-muted",
    STOPPED: "bg-negative/20 text-negative",
  };
  const label = reason ? `${status} (${reason})` : status;
  return (
    <span className={`px-2 py-0.5 rounded text-xs ${map[status] ?? "text-muted"}`}>
      {label}
    </span>
  );
}
