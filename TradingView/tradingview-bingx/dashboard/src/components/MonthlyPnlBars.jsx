import React, { useMemo } from "react";

/**
 * Barras diárias de P&L do mês corrente.
 * Verde = dia positivo, vermelho = dia negativo, cinza = sem trade.
 * SVG puro para portabilidade; sem dep adicional.
 */
export function MonthlyPnlBars({ dailySeries = [], goalProgress }) {
  const data = useMemo(() => {
    // Gera array com todos os dias do mês corrente
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const yearMonth = now.toISOString().slice(0, 7); // "YYYY-MM"

    const byDate = Object.fromEntries(dailySeries.map((d) => [d.date, d]));
    return Array.from({ length: daysInMonth }, (_, i) => {
      const day   = String(i + 1).padStart(2, "0");
      const date  = `${yearMonth}-${day}`;
      const row   = byDate[date];
      return {
        day: i + 1,
        date,
        pnl: row?.pnl ?? 0,
        tradeCount: row?.tradeCount ?? 0,
        hasTrade: !!row,
      };
    });
  }, [dailySeries]);

  const maxAbs = Math.max(5, ...data.map((d) => Math.abs(d.pnl)));
  const height = 160;
  const centerY = height / 2;
  const barW    = 100 / data.length;
  const today   = new Date().getDate();

  // Stats
  const totalPnl = data.reduce((s, d) => s + d.pnl, 0);
  const positiveDays = data.filter((d) => d.pnl > 0).length;
  const negativeDays = data.filter((d) => d.pnl < 0).length;
  const bestDay  = data.reduce((a, b) => (b.pnl > a.pnl ? b : a), { pnl: 0 });
  const worstDay = data.reduce((a, b) => (b.pnl < a.pnl ? b : a), { pnl: 0 });

  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-card">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xs text-muted tracking-[0.15em] font-medium">
            P&L DIÁRIO — {new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" }).toUpperCase()}
          </h2>
          <p className="text-[10px] text-muted-dim mt-0.5">
            {positiveDays}W / {negativeDays}L · Total:
            <span className={`ml-1 font-mono font-bold ${totalPnl >= 0 ? "text-positive" : "text-negative"}`}>
              {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}
            </span>
          </p>
        </div>
        <div className="flex gap-4 text-xs">
          <Badge label="Melhor" value={`+$${bestDay.pnl.toFixed(2)}`} color="text-positive" />
          <Badge label="Pior"   value={`$${worstDay.pnl.toFixed(2)}`} color="text-negative" />
        </div>
      </div>

      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="w-full" style={{ height: `${height}px` }}>
        {/* Eixo zero */}
        <line x1="0" y1={centerY} x2="100" y2={centerY}
              stroke="currentColor" strokeWidth="0.08" className="text-border-light" />
        {/* Linha pace esperado (positivo) */}
        {goalProgress?.floor && (
          <line
            x1="0"
            y1={centerY - ((goalProgress.floor / new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()) / maxAbs) * (height / 2 - 4)}
            x2="100"
            y2={centerY - ((goalProgress.floor / new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()) / maxAbs) * (height / 2 - 4)}
            stroke="currentColor"
            strokeWidth="0.1"
            strokeDasharray="0.5,0.5"
            className="text-accent/40"
          />
        )}

        {/* Barras */}
        {data.map((d, i) => {
          if (!d.hasTrade) return null;
          const x    = i * barW + barW * 0.15;
          const w    = barW * 0.7;
          const h    = (Math.abs(d.pnl) / maxAbs) * (height / 2 - 6);
          const y    = d.pnl >= 0 ? centerY - h : centerY;
          const color = d.pnl >= 0 ? "fill-positive" : "fill-negative";
          return (
            <rect
              key={d.date}
              x={x}
              y={y}
              width={w}
              height={Math.max(0.5, h)}
              className={`${color} transition-opacity hover:opacity-70`}
              rx="0.3"
            >
              <title>{`Dia ${d.day}: ${d.pnl >= 0 ? "+" : ""}$${d.pnl.toFixed(2)} (${d.tradeCount} trade${d.tradeCount > 1 ? "s" : ""})`}</title>
            </rect>
          );
        })}

        {/* Marcador "hoje" */}
        <line
          x1={(today - 0.5) * barW}
          y1="0"
          x2={(today - 0.5) * barW}
          y2={height}
          stroke="currentColor"
          strokeWidth="0.08"
          strokeDasharray="0.4,0.4"
          className="text-accent/50"
        />
      </svg>

      {/* Eixo X — labels: 1, 5, 10, 15, 20, 25, último dia */}
      <div className="flex justify-between text-[10px] text-muted-dim mt-1 font-mono">
        {[1, 5, 10, 15, 20, 25, data.length].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
    </div>
  );
}

function Badge({ label, value, color }) {
  return (
    <div className="text-right">
      <div className="text-[10px] text-muted-dim">{label}</div>
      <div className={`font-mono text-xs font-bold ${color}`}>{value}</div>
    </div>
  );
}
