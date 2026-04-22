import React, { useMemo } from "react";

/**
 * SymbolPerformance — heatmap + tabela com performance por ativo.
 * Identifica quais ativos estão gerando lucro e quais devem ser pausados.
 *
 * Props:
 *   bySymbol: [{ symbol, trades, wins, losses, winRate, totalPnl, avgPnl }]
 */
export function SymbolPerformance({ bySymbol = [] }) {
  const rows = useMemo(() => {
    return [...bySymbol]
      .filter((s) => s.trades > 0)
      .sort((a, b) => (b.totalPnl || 0) - (a.totalPnl || 0));
  }, [bySymbol]);

  if (!rows.length) {
    return (
      <div className="bg-card border border-border rounded-xl p-5 shadow-card">
        <h2 className="text-xs text-muted tracking-[0.15em] font-medium mb-4">PERFORMANCE POR ATIVO</h2>
        <p className="text-xs text-muted-dim">Sem trades fechados.</p>
      </div>
    );
  }

  const maxAbsPnl = Math.max(1, ...rows.map((r) => Math.abs(r.totalPnl || 0)));

  const symbolLabel = (s) => {
    if (s.includes("GOLD"))  return "GOLD";
    if (s.includes("XAG"))   return "SILVER";
    if (s.includes("OIL"))   return "OIL WTI";
    return s.replace("USDT", "").replace("-USDT", "");
  };

  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-card">
      <div className="mb-4">
        <h2 className="text-xs text-muted tracking-[0.15em] font-medium">PERFORMANCE POR ATIVO</h2>
        <p className="text-[10px] text-muted-dim mt-0.5">{rows.length} ativos com trades</p>
      </div>

      <div className="space-y-2">
        {rows.map((r) => {
          const wr = r.winRate ?? (r.trades > 0 ? (r.wins / r.trades) * 100 : 0);
          const pct = (Math.abs(r.totalPnl || 0) / maxAbsPnl) * 100;
          const isPos = (r.totalPnl || 0) >= 0;

          return (
            <div key={r.symbol} className="group">
              <div className="flex items-center justify-between text-xs mb-1">
                <div className="flex items-center gap-3">
                  <span className="font-mono font-semibold text-text w-20">
                    {symbolLabel(r.symbol)}
                  </span>
                  <span className="text-[10px] text-muted-dim">
                    {r.trades} trades · {r.wins}W/{r.losses}L · WR {wr.toFixed(0)}%
                  </span>
                </div>
                <span className={`font-mono font-bold ${isPos ? "text-positive" : "text-negative"}`}>
                  {isPos ? "+" : ""}${(r.totalPnl || 0).toFixed(2)}
                </span>
              </div>
              <div className="h-1.5 rounded-sm bg-border/50 overflow-hidden relative">
                <div
                  className={`h-full transition-all ${isPos ? "bg-positive" : "bg-negative"}`}
                  style={{
                    width: `${pct}%`,
                    marginLeft: isPos ? "50%" : `${50 - pct}%`,
                  }}
                />
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border-light" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
