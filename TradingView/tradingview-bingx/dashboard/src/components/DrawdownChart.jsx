import React, { useMemo } from "react";

/**
 * DrawdownChart — área sob zero mostrando drawdown (%) ao longo do tempo.
 * Ajuda a identificar: maior drawdown histórico, duração das perdas, recuperação.
 *
 * Props:
 *   series: [{ date, cumulativePnl, peak, drawdownPct, drawdownDollar }]
 */
export function DrawdownChart({ series = [] }) {
  const stats = useMemo(() => {
    if (!series.length) return null;
    const maxDd = series.reduce(
      (a, b) => (b.drawdownPct < a.drawdownPct ? b : a),
      { drawdownPct: 0, drawdownDollar: 0, date: "" }
    );
    const currentDd = series[series.length - 1];
    // Duração atual do drawdown (dias consecutivos com dd < 0)
    let ddDays = 0;
    for (let i = series.length - 1; i >= 0; i--) {
      if (series[i].drawdownPct < 0) ddDays++;
      else break;
    }
    return { maxDd, currentDd, ddDays };
  }, [series]);

  if (!series.length || !stats) {
    return (
      <div className="bg-card border border-border rounded-xl p-5 shadow-card">
        <h2 className="text-xs text-muted tracking-[0.15em] font-medium mb-4">DRAWDOWN</h2>
        <p className="text-xs text-muted-dim">Sem histórico suficiente.</p>
      </div>
    );
  }

  const width = 100;
  const height = 120;
  const maxAbsDd = Math.max(1, Math.abs(stats.maxDd.drawdownPct));
  const step = width / Math.max(1, series.length - 1);

  // Path para área de drawdown
  const pathD = series
    .map((p, i) => {
      const x = i * step;
      const y = (Math.abs(p.drawdownPct) / maxAbsDd) * (height - 10);
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  const areaD = `${pathD} L${width},${height} L0,${height} Z`;

  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-card">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xs text-muted tracking-[0.15em] font-medium">DRAWDOWN</h2>
          <p className="text-[10px] text-muted-dim mt-0.5">
            Queda % abaixo do pico de equity
          </p>
        </div>
        <div className="flex gap-4 text-xs">
          <div className="text-right">
            <div className="text-[10px] text-muted-dim">Máx histórico</div>
            <div className="font-mono text-xs font-bold text-negative">
              {stats.maxDd.drawdownPct.toFixed(2)}%
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-muted-dim">Atual</div>
            <div className={`font-mono text-xs font-bold ${stats.currentDd.drawdownPct < 0 ? "text-warning" : "text-positive"}`}>
              {stats.currentDd.drawdownPct.toFixed(2)}%
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-muted-dim">Dias em DD</div>
            <div className="font-mono text-xs font-bold text-text">
              {stats.ddDays}d
            </div>
          </div>
        </div>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height: `${height}px` }}>
        <defs>
          <linearGradient id="dd-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FF3D57" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#FF3D57" stopOpacity="0.05" />
          </linearGradient>
        </defs>
        {/* Grid horizontal - linhas de referência */}
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1="0"
            y1={height * f}
            x2={width}
            y2={height * f}
            stroke="currentColor"
            strokeWidth="0.1"
            strokeDasharray="0.3,0.3"
            className="text-border-light"
          />
        ))}
        {/* Área drawdown */}
        <path d={areaD} fill="url(#dd-gradient)" />
        {/* Linha drawdown */}
        <path
          d={pathD}
          fill="none"
          stroke="currentColor"
          strokeWidth="0.4"
          className="text-negative"
        />
      </svg>

      <div className="flex justify-between text-[10px] text-muted-dim mt-1 font-mono">
        <span>{series[0]?.date?.slice(5) ?? ""}</span>
        <span>{series[Math.floor(series.length / 2)]?.date?.slice(5) ?? ""}</span>
        <span>{series[series.length - 1]?.date?.slice(5) ?? ""}</span>
      </div>

      {stats.maxDd.drawdownDollar !== 0 && (
        <div className="mt-3 pt-3 border-t border-border flex items-center justify-between text-xs">
          <span className="text-muted">Maior perda em $ (desde o pico)</span>
          <span className="font-mono font-bold text-negative">
            ${stats.maxDd.drawdownDollar.toFixed(2)}
            <span className="text-muted-dim ml-2">em {stats.maxDd.date?.slice(5)}</span>
          </span>
        </div>
      )}
    </div>
  );
}
