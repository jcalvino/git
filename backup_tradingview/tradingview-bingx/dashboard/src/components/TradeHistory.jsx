import { useState } from "react";

export function TradeHistory({ trades = [] }) {
  const [filter, setFilter]     = useState("ALL");
  const [selected, setSelected] = useState(null); // trade id

  const symbols = [...new Set(trades.map((t) => t.symbol))];

  const filtered =
    filter === "ALL"   ? trades
    : filter === "WIN"  ? trades.filter((t) => (t.pnl ?? 0) > 0)
    : filter === "LOSS" ? trades.filter((t) => t.status === "CLOSED" && (t.pnl ?? 0) <= 0)
    : trades.filter((t) => t.symbol === filter);

  const selectedTrade = selected != null ? trades.find((t) => t.id === selected) : null;

  const handleRowClick = (trade) => {
    setSelected((prev) => (prev === trade.id ? null : trade.id));
  };

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-3">
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

      {/* Two-pane layout when a trade is selected */}
      <div className={`flex gap-4 ${selectedTrade ? "items-start" : ""}`}>

        {/* Trade list */}
        <div className={`overflow-x-auto ${selectedTrade ? "flex-1 min-w-0" : "w-full"}`}>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted border-b border-border">
                <th className="text-left py-2 pr-3">Date</th>
                <th className="text-left py-2 pr-3">Symbol</th>
                <th className="text-left py-2 pr-3">Setup</th>
                <th className="text-left py-2 pr-3">Dir</th>
                <th className="text-right py-2 pr-3">Entry</th>
                <th className="text-right py-2 pr-3">Exit</th>
                <th className="text-right py-2 pr-3">P&amp;L</th>
                <th className="text-right py-2 pr-3">%</th>
                <th className="text-right py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-muted text-center py-6">
                    No trades found
                  </td>
                </tr>
              )}
              {filtered.map((t) => {
                const pnl      = t.pnl ?? 0;
                const isProfit = pnl > 0;
                const isOpen   = t.status === "OPEN" || t.status === "PARTIAL";
                const isActive = selected === t.id;
                const pnlColor = isOpen
                  ? "text-muted"
                  : isProfit
                  ? "text-positive"
                  : "text-negative";

                return (
                  <tr
                    key={t.id}
                    onClick={() => handleRowClick(t)}
                    className={`border-b border-border/50 cursor-pointer transition-colors ${
                      isActive
                        ? "bg-accent/10 border-accent/30"
                        : "hover:bg-card/50"
                    }`}
                  >
                    <td className="py-2 pr-3 text-muted whitespace-nowrap">
                      {new Date(t.opened_at).toLocaleDateString("pt-BR")}
                    </td>
                    <td className="py-2 pr-3 font-medium">{t.symbol}</td>
                    <td className="py-2 pr-3 text-muted truncate max-w-[120px]" title={t.setup_name ?? ""}>
                      {t.setup_name ? (
                        <span className="px-1.5 py-0.5 rounded bg-accent/10 text-accent text-xs">
                          {t.setup_name.replace(/^Setup \d+ — /, "").replace(/^Setup \d+ ─ /, "")}
                        </span>
                      ) : (
                        <span className="text-border">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <span className={t.direction === "LONG" ? "text-positive" : "text-negative"}>
                        {t.direction}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right font-mono">
                      ${t.entry_price?.toLocaleString()}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono">
                      {t.exit_price ? `$${t.exit_price.toLocaleString()}` : "—"}
                    </td>
                    <td className={`py-2 pr-3 text-right font-mono font-medium ${pnlColor}`}>
                      {isOpen ? "open" : `${isProfit ? "+" : ""}$${pnl.toFixed(2)}`}
                    </td>
                    <td className={`py-2 pr-3 text-right font-mono ${pnlColor}`}>
                      {t.pnl_pct != null
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

        {/* Detail / Rationale panel */}
        {selectedTrade && (
          <div className="w-72 xl:w-80 shrink-0 rounded-lg border border-accent/30 bg-accent/5 p-4 text-xs space-y-3 sticky top-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <span className="text-accent font-semibold tracking-wider text-xs">TRADE DETAIL</span>
              <button
                onClick={() => setSelected(null)}
                className="text-muted hover:text-text transition-colors text-sm leading-none"
              >
                ×
              </button>
            </div>

            {/* Symbol + direction */}
            <div className="flex items-center gap-2">
              <span
                className={`px-2 py-0.5 rounded font-bold ${
                  selectedTrade.direction === "LONG"
                    ? "bg-positive/20 text-positive"
                    : "bg-negative/20 text-negative"
                }`}
              >
                {selectedTrade.direction}
              </span>
              <span className="font-semibold text-text">{selectedTrade.symbol}</span>
              {selectedTrade.signal_score != null && (
                <span className="ml-auto text-accent font-mono font-bold">
                  {selectedTrade.signal_score}pts
                </span>
              )}
            </div>

            {/* Setup name */}
            {selectedTrade.setup_name && (
              <div>
                <span className="text-muted block mb-0.5">Setup</span>
                <span className="text-text">{selectedTrade.setup_name}</span>
              </div>
            )}

            {/* Price levels */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-muted block">Entry</span>
                <span className="font-mono">${selectedTrade.entry_price?.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-muted block">Exit</span>
                <span className="font-mono">
                  {selectedTrade.exit_price
                    ? `$${selectedTrade.exit_price?.toLocaleString()}`
                    : "—"}
                </span>
              </div>
              <div>
                <span className="text-muted block">SL</span>
                <span className="font-mono text-negative">
                  {selectedTrade.sl_price ? `$${selectedTrade.sl_price?.toLocaleString()}` : "—"}
                </span>
              </div>
              <div>
                <span className="text-muted block">TP1</span>
                <span className="font-mono text-positive">
                  {selectedTrade.tp1_price ? `$${selectedTrade.tp1_price?.toLocaleString()}` : "—"}
                </span>
              </div>
              <div>
                <span className="text-muted block">TP2</span>
                <span className="font-mono text-positive">
                  {selectedTrade.tp2_price ? `$${selectedTrade.tp2_price?.toLocaleString()}` : "—"}
                </span>
              </div>
              <div>
                <span className="text-muted block">TP3</span>
                <span className="font-mono text-positive">
                  {selectedTrade.tp3_price ? `$${selectedTrade.tp3_price?.toLocaleString()}` : "—"}
                </span>
              </div>
            </div>

            {/* Rationale */}
            {selectedTrade.rationale?.length > 0 ? (
              <div>
                <span className="text-muted block mb-1.5">Entry reasons</span>
                <ul className="space-y-1.5">
                  {selectedTrade.rationale.map((item, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-accent mt-0.5 shrink-0">›</span>
                      <span className="text-text leading-relaxed">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="text-muted italic">
                No rationale recorded
                {selectedTrade.trade_type === "EXTERNAL" && " (external trade)"}
              </div>
            )}

            {/* P&L summary */}
            {selectedTrade.pnl != null && selectedTrade.status !== "OPEN" && (
              <div className="pt-2 border-t border-border">
                <div className="flex justify-between items-center">
                  <span className="text-muted">Result</span>
                  <span
                    className={`font-mono font-bold ${
                      selectedTrade.pnl > 0 ? "text-positive" : "text-negative"
                    }`}
                  >
                    {selectedTrade.pnl > 0 ? "+" : ""}${selectedTrade.pnl.toFixed(2)}
                    {selectedTrade.pnl_pct != null && (
                      <span className="ml-1 font-normal text-xs">
                        ({selectedTrade.pnl > 0 ? "+" : ""}
                        {selectedTrade.pnl_pct.toFixed(2)}%)
                      </span>
                    )}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status, reason }) {
  const map = {
    OPEN:    "bg-accent/20 text-accent",
    PARTIAL: "bg-accent/20 text-accent",
    CLOSED:  "bg-muted/20 text-muted",
    STOPPED: "bg-negative/20 text-negative",
  };
  const label = reason ? `${status} (${reason})` : status;
  return (
    <span className={`px-2 py-0.5 rounded text-xs ${map[status] ?? "text-muted"}`}>
      {label}
    </span>
  );
}
